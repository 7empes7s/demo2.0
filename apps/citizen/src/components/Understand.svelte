<script lang="ts">
  import { buildQuiz, shuffled, textIn, type Evidence, type Lang, type LocalizedText } from "@democracy2/arena";
  import type { DocketItem } from "@democracy2/companion";
  import { tick } from "svelte";

  import { progressOf, recordAttempt, understoodCount } from "../lib/arena.svelte.ts";
  import { safeUrl } from "../lib/data.ts";
  import { LANG_LABELS, type Key } from "../lib/i18n.ts";
  import { t, ui } from "../lib/ui.svelte.ts";

  /**
   * Arena v1: a few questions on what this file's official text says, answered on this device.
   * Every answer the text supports is shown with the passage it is quoted from and a link to it.
   * Nothing is sent anywhere; progress is kept in this browser only.
   */
  let { item, items }: { item: DocketItem; items: DocketItem[] } = $props();

  const quiz = $derived(buildQuiz(item, items));
  const progress = $derived(progressOf(item.id));

  let phase = $state<"intro" | "asking" | "done">("intro");
  let index = $state(0);
  let answers = $state<(string | null)[]>([]);
  let attempt = $state(0);
  let heading = $state<HTMLElement | null>(null);
  const uid = $props.id();

  const question = $derived(quiz && phase === "asking" ? quiz.questions[index] : null);
  const options = $derived(question ? shuffled(question.options, `${item.id}:${attempt}:${question.id}`) : []);
  const picked = $derived(answers[index] ?? null);
  const matched = $derived(quiz ? quiz.questions.filter((q, i) => answers[i] === q.answer).length : 0);
  const total = $derived(quiz?.questions.length ?? 0);
  const allMatched = $derived(phase === "done" && total > 0 && matched === total);

  const LANG_KEYS: Partial<Record<Lang, Key>> = { fr: "lang_name_fr", de: "lang_name_de", en: "lang_name_en" };
  const langName = (l: Lang) => (LANG_KEYS[l] ? t(LANG_KEYS[l]!) : LANG_LABELS[l]);
  const show = (text: LocalizedText) => textIn(text, ui.lang);

  /** A vote count reads "Oui: 11", not a bare "11". */
  function passage(e: Evidence): string {
    const m = /^votes\.counts\.(.+)$/.exec(e.field);
    return m ? `${m[1]}: ${e.quote}` : e.quote;
  }
  const pages = $derived(new Set(Object.values(item.urls)));
  /** Each link once, labelled as the official page or a document. */
  const links = $derived(
    question ? [...new Set(question.evidence.map((e) => e.url))].map((url) => ({ url: safeUrl(url), page: pages.has(url) })).filter((l) => l.url) : [],
  );

  async function focusHeading() {
    await tick();
    heading?.focus({ preventScroll: false });
  }

  function start() {
    attempt = (progress?.attempts ?? 0) + 1;
    answers = [];
    index = 0;
    phase = "asking";
    focusHeading();
  }

  function pick(id: string) {
    if (picked !== null) return;
    answers[index] = id;
  }

  function next() {
    if (!quiz) return;
    if (index + 1 < quiz.questions.length) {
      index += 1;
      focusHeading();
      return;
    }
    recordAttempt(item.id, matched, total);
    phase = "done";
    focusHeading();
  }

  const RING = 2 * Math.PI * 34;
</script>

{#if quiz}
  <section class="arena card" aria-labelledby="{uid}-h" data-phase={phase}>
    {#if phase === "intro"}
      <div class="intro">
        <div class="head">
          <span class="glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.6-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z" /></svg>
          </span>
          <h3 id="{uid}-h" class="serif title">{t("arena_title")}</h3>
          {#if progress?.understood}<span class="badge" data-badge="understood">{t("arena_understood")}</span>{/if}
        </div>
        <p class="lead">{t("arena_intro", { n: total })}</p>
        <ul class="notes muted">
          <li>{t("arena_neutral")}</li>
          <li>{t("arena_private")}</li>
        </ul>
        <div class="actions">
          <button class="btn primary" onclick={start}>{progress ? t("arena_retake") : t("arena_start")}</button>
          {#if progress}<span class="muted small" data-best>{t("arena_best", { k: progress.best, n: progress.total })}</span>{/if}
        </div>
      </div>
    {:else if phase === "asking" && question}
      {@const prompt = show(question.prompt)}
      {@const shown = options.map((o) => ({ id: o.id, ...show(o.text) }))}
      {@const foreign = shown.find((o) => o.lang !== ui.lang)}
      <div class="ask">
        <div class="bar" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1} aria-label={t("arena_progress", { i: index + 1, n: total })}>
          {#each quiz.questions as q, i (q.id)}
            <span class="seg" data-state={i < index || (i === index && picked) ? (answers[i] === q.answer ? "match" : "miss") : i === index ? "now" : "todo"}></span>
          {/each}
        </div>
        <p class="label count">{t("arena_progress", { i: index + 1, n: total })}</p>
        <h3 id="{uid}-h" class="prompt" tabindex="-1" bind:this={heading} lang={prompt.lang}>{prompt.text}</h3>
        {#if prompt.lang !== ui.lang}<p class="muted small note">{t("arena_lang_prompt", { lang: langName(prompt.lang) })}</p>{/if}
        <div class="options" role="group" aria-labelledby="{uid}-h">
          {#each shown as o (o.id)}
            {@const state = picked === null ? "open" : o.id === question.answer ? "text" : o.id === picked ? "miss" : "rest"}
            <button class="option" data-state={state} aria-pressed={picked === o.id} aria-disabled={picked !== null} onclick={() => pick(o.id)} lang={o.lang}>
              <span class="mark" aria-hidden="true">{state === "text" ? "✓" : state === "miss" ? "×" : ""}</span>
              <span>{o.text}</span>
            </button>
          {/each}
        </div>
        {#if foreign}<p class="muted small note">{t("arena_lang_options", { lang: langName(foreign.lang) })}</p>{/if}

        <div aria-live="polite" class="feedback-slot">
          {#if picked !== null}
            {@const ok = picked === question.answer}
            <div class="feedback" data-result={ok ? "match" : "miss"}>
              <p class="verdict">{t(ok ? "arena_match" : "arena_miss")}</p>
              <figure class="quote">
                <figcaption class="label">{t("arena_text_says")}</figcaption>
                {#each question.evidence as e, i (i)}
                  <blockquote lang="fr">{passage(e)}</blockquote>
                {/each}
                {#each links as l (l.url)}
                  <a href={l.url} target="_blank" rel="noopener">{t(l.page ? "arena_open_page" : "arena_open_doc")} ↗</a>
                {/each}
              </figure>
              <p class="muted small origin">{t(question.origin === "seed" ? "arena_seed" : "arena_rules")}</p>
            </div>
          {/if}
        </div>
        {#if picked !== null}
          <button class="btn primary next" onclick={next}>{t(index + 1 < total ? "arena_next" : "arena_finish")} →</button>
        {/if}
      </div>
    {:else if phase === "done"}
      <div class="done" data-result={allMatched ? "all" : "some"}>
        <div class="score">
          <svg viewBox="0 0 80 80" width="88" height="88" aria-hidden="true">
            <circle cx="40" cy="40" r="34" class="track" />
            <circle cx="40" cy="40" r="34" class="fill" stroke-dasharray={RING} stroke-dashoffset={RING * (1 - matched / total)} />
            <text x="40" y="46" text-anchor="middle" class="num">{matched}/{total}</text>
          </svg>
          <div class="score-text">
            <h3 id="{uid}-h" class="serif title" tabindex="-1" bind:this={heading}>{t("arena_score", { k: matched, n: total })}</h3>
            {#if allMatched}<span class="badge big" data-badge="understood">{t("arena_understood")}</span>{/if}
          </div>
        </div>
        <p>{t(allMatched ? "arena_all" : "arena_some")}</p>
        <p class="muted small" data-count>{understoodCount() === 1 ? t("arena_count_one") : t("arena_count_many", { n: understoodCount() })}</p>
        <div class="actions">
          <button class="btn" onclick={start}>{t("arena_retake")}</button>
        </div>
        <p class="muted small">{t("arena_private")}</p>
      </div>
    {/if}
  </section>
{/if}

<style>
  .arena {
    display: grid;
    gap: 14px;
    overflow-wrap: anywhere;
  }
  .intro, .ask, .done { display: grid; gap: 12px; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .glyph {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: var(--rule) solid var(--line);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .title { font-size: 1.5rem; line-height: 1.15; margin: 0; }
  .title:focus, .prompt:focus { outline: none; }
  .lead { margin: 0; }
  .notes { margin: 0; padding-left: 1.1rem; font-size: 0.88rem; display: grid; gap: 2px; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
  .small { font-size: 0.84rem; }
  .note { margin: -4px 0 0; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    border: 2px solid var(--accent-line);
    background: var(--accent);
    color: var(--accent-ink);
    font: 700 0.8rem/1.5 var(--serif);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .badge::before { content: "✓"; }
  .badge.big { font-size: 0.95rem; padding: 0.3rem 0.9rem 0.3rem 0.7rem; }

  .bar { display: flex; gap: 6px; }
  .seg { flex: 1 1 0; height: 8px; border: 2px solid var(--line); background: var(--surface); transition: background 200ms; }
  .seg[data-state="now"] { background: var(--accent); }
  .seg[data-state="match"] { background: var(--fg); }
  .seg[data-state="miss"] { background: var(--red); }
  .count { margin: 0; }
  .prompt { font-size: 1.15rem; font-weight: 650; line-height: 1.35; margin: 0; }

  .options { display: grid; gap: 8px; }
  .option {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    text-align: left;
    width: 100%;
    min-height: 48px;
    padding: 0.7rem 0.9rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    color: var(--fg);
    cursor: pointer;
    line-height: 1.4;
    transition: box-shadow 120ms, background 160ms, transform 120ms;
  }
  .option[data-state="open"]:hover { box-shadow: 5px 5px 0 0 var(--accent), 5px 5px 0 var(--rule) var(--backing); }
  .option[data-state="open"]:active { transform: scale(0.99); }
  .option[aria-disabled="true"] { cursor: default; }
  .option[data-state="rest"] { opacity: 0.6; }
  .mark {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border: 2px solid var(--line);
    font-family: var(--serif);
    font-weight: 900;
    font-size: 0.9rem;
  }
  .option[data-state="text"] { background: var(--accent); color: var(--accent-ink); }
  .option[data-state="text"] .mark { background: var(--fg); color: var(--surface); }
  .option[data-state="miss"] { background: var(--surface); text-decoration: line-through; }
  .option[data-state="miss"] .mark { border-color: var(--red); color: var(--red); }

  .feedback-slot:empty { display: none; }
  .feedback { display: grid; gap: 10px; }
  .verdict { margin: 0; font-weight: 700; font-size: 1.05rem; }
  .feedback[data-result="match"] .verdict { color: var(--green); }
  .feedback[data-result="miss"] .verdict { color: var(--fg); }
  .quote {
    margin: 0;
    display: grid;
    gap: 6px;
    padding: 0.8rem 1rem;
    border-left: 4px solid var(--line);
    background: var(--surface);
  }
  .quote blockquote { margin: 0; font-size: 1.12rem; line-height: 1.4; }
  .quote blockquote::before { content: "«\00a0"; color: var(--accent-fg); }
  .quote blockquote::after { content: "\00a0»"; color: var(--accent-fg); }
  .quote a { color: var(--fg); font-weight: 600; font-size: 0.9rem; justify-self: start; }
  .origin { margin: 0; }
  .next { justify-self: start; }

  .score { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .score-text { display: grid; gap: 8px; justify-items: start; min-width: 0; flex: 1 1 12rem; }
  .done p { margin: 0; }
  .track { fill: none; stroke: var(--line); stroke-width: 7; }
  .fill {
    fill: none;
    stroke: var(--accent);
    stroke-width: 7;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 40px 40px;
  }
  .done[data-result="all"] .fill { stroke: var(--green); }
  .num { fill: var(--fg); font: 900 18px var(--serif); }

  @media (prefers-reduced-motion: no-preference) {
    .option[data-state="text"], .option[data-state="miss"] { animation: pop 260ms ease-out; }
    .feedback { animation: rise 240ms ease-out; }
    .fill { transition: stroke-dashoffset 700ms ease-out; animation: draw 900ms ease-out; }
    .badge.big { animation: pop 420ms 300ms ease-out both; }
    @keyframes pop { 0% { transform: scale(0.97); } 60% { transform: scale(1.02); } 100% { transform: scale(1); } }
    @keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes draw { from { stroke-dashoffset: 213.6; } }
  }
  @media (min-width: 960px) {
    .arena { padding: 1.4rem 1.6rem; }
    .options { grid-template-columns: minmax(0, 1fr); }
    .prompt { font-size: 1.25rem; }
  }
</style>
