// Pulse: the resident's weekly list, built on the device.
//
//   const week = weekAt(new Date());
//   buildWeek({ items: snapshot.items, places, prefs: { home: "lu-commune-esch-sur-alzette", topics: [] }, week })
//
// Everything here is a pure function of public data plus what the resident told their own
// device. Nothing reads the clock, storage or the network. Node-only Charter loading lives in
// `@democracy2/pulse/charter`.

export { buildWeek, topicList, topicsOf, whenIn } from "./pulse.ts";
export type { BuildInput, Entry, Preferences, PublicItem, WeeklyList, WhenKind } from "./pulse.ts";
export { DOCKET_ALIASES, charterIdOf, containingPlaces, homeChoices, indexPlaces, placeName } from "./places.ts";
export type { Place, PlaceIndex } from "./places.ts";
export { TIME_ZONE, dayOf, inWeek, isoWeek, luxembourgDate, weekAt } from "./week.ts";
export type { Week } from "./week.ts";
