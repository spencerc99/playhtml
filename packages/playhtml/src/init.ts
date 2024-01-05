import { playhtml } from "./main";
playhtml.init({});
const playStyles = document.createElement("link");
playStyles.rel = "stylesheet";
playStyles.href = "https://unpkg.com/playhtml@latest/dist/style.css";
document.head.appendChild(playStyles);
