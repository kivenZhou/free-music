import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/outfit/800.css";
import App from "./App";
import DesktopLyricsApp from "./DesktopLyricsApp";

const params = new URLSearchParams(window.location.search);
const isDesktopLyrics = params.get("view") === "desktop-lyrics";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isDesktopLyrics ? <DesktopLyricsApp /> : <App />}
  </React.StrictMode>,
);
