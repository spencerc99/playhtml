import "./style.scss";

const canMoveEles = document.querySelectorAll("[can-move]");
for (const canMoveEle of canMoveEles) {
  canMoveEle.style.position = "absolute";
  canMoveEle.setAttribute("draggable", "true");
  canMoveEle.addEventListener("dragstart", (e) => {
    const target = e.target as HTMLElement;
    const x = e.clientX - target.offsetLeft;
    const y = e.clientY - target.offsetTop;
    e.dataTransfer.setData("text/plain", `${x},${y}`);
    canMoveEle.style.transform = `translate(${x}px, ${y}px)`;
  });
}
