export function invertColor(hex: string, bw: boolean): string {
  if (hex.indexOf("#") === 0) {
    hex = hex.slice(1);
  }
  // convert 3-digit hex to 6-digits.
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) {
    throw new Error("Invalid HEX color.");
  }
  let r = parseInt(hex.slice(0, 2), 16),
    g = parseInt(hex.slice(2, 4), 16),
    b = parseInt(hex.slice(4, 6), 16);
  if (bw) {
    // http://stackoverflow.com/a/3943023/112731
    return r * 0.299 + g * 0.587 + b * 0.114 > 186 ? "#000000" : "#FFFFFF";
  }
  // invert color components
  let rStr = (255 - r).toString(16);
  let gStr = (255 - g).toString(16);
  let bStr = (255 - b).toString(16);
  // pad each with zeros and return
  return "#" + padZero(rStr) + padZero(gStr) + padZero(bStr);
}

function padZero(str: string): string {
  var zeros = new Array(2).join("0");
  return (zeros + str).slice(-2);
}
