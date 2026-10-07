import { mount } from "svelte";

import App from "./App.svelte";
import "./tokens.css";
import "./portal.css";

mount(App, { target: document.getElementById("app") as HTMLElement });
