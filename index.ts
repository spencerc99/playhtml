import "./home.scss";

// TODO: convert the guestbook to react and make the hook to make that possible
function saveName(e: any) {
  localStorage.setItem("name", JSON.stringify(e.currentTarget.value));
}

const nameInput = document.getElementsByName("name")[0] as HTMLInputElement;
nameInput.value = localStorage.getItem("name")
  ? JSON.parse(localStorage.getItem("name")!)
  : "";
nameInput.addEventListener("change", saveName);
