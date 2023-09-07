import "./home.scss";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";

// ReactDOM.createRoot(
//   document.getElementById("reactContent") as HTMLElement
// ).render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>
// );

// TODO: convert the guestbook to react and make the hook to make that possible

function saveName(e: any) {
  localStorage.setItem("name", JSON.stringify(e.currentTarget.value));
}
