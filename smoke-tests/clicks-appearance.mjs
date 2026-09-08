// ABOUTME: Compares Canvas click pixels against the SVG renderer at matching times.
// ABOUTME: Allows edge rasterization differences while checking overlap colors and geometry.
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";

export async function verifyClickAppearance(page, outputDirectory) {
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  const now = await page.evaluate(() => Date.now());
  const results = [];
  for (const state of ["expanding", "settled", "faded", "mixed"]) {
    const effects = Array.from(
      { length: state === "faded" ? 2003 : 3 },
      (_, i) => ({
        id: `${state}-${i}`,
        sourceId: `${state}-${i}`,
        x: i < 3 ? 100 + i * 38 : -1000,
        y: i < 3 ? 140 + i * 9 : -1000,
        color: ["#e35950", "#3a87bd", "#76a658"][i % 3],
        radiusFactor: 0.65,
        durationFactor: 0.5,
        trailIndex: 0,
        startTime:
          state === "expanding" || (state === "mixed" && i === 1)
            ? now - 744
            : 0,
        completed: state === "faded" || (state === "mixed" && i !== 1),
      }),
    );
    const images = [];
    for (const mode of ["svg", "canvas"]) {
      if (mode === "svg") {
        await page.evaluate(() => {
          window.drawing?.destroy();
          window.drawingCanvas?.remove();
        });
        await page.evaluate(
          (effects) =>
            window.renderScene(
              effects,
              { clickMinRadius: 80, clickMaxRadius: 80, clickStrokeWidth: 5 },
              "svg",
            ),
          effects,
        );
        await page.waitForFunction(
          () => Number(document.querySelector("circle")?.getAttribute("r")) > 0,
        );
      } else {
        await page.evaluate(() => window.clearClicks());
        await page.waitForFunction(() => !document.querySelector("svg"));
        await page.evaluate((effects) => {
          window.createDrawing();
          const canvas = window.drawingCanvas;
          canvas.style.cssText = "position:absolute;left:0;top:0";
          document.body.append(canvas);
          window.drawing.resize(400, 300, 1);
          window.drawing.update(
            effects,
            {
              ...window.defaultSettings,
              clickNumRings: 6,
              clickMinRadius: 80,
              clickMaxRadius: 80,
              clickStrokeWidth: 5,
            },
            Date.now(),
          );
          window.drawing.tick(Date.now(), true);
        }, effects);
      }
      const image = await page.screenshot(
        outputDirectory
          ? { path: path.join(outputDirectory, `${state}-${mode}.png`) }
          : {},
      );
      images.push(image.toString("base64"));
    }
    const difference = await page.evaluate(async (images) => {
      const pixels = [];
      for (const image of images) {
        const img = new Image();
        img.src = `data:image/png;base64,${image}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const context = c.getContext("2d");
        context.drawImage(img, 0, 0);
        pixels.push(context.getImageData(0, 0, c.width, c.height).data);
      }
      const [svg, canvas] = pixels;
      let error = 0,
        interiorPixels = 0,
        maximumInteriorDifference = 0;
      for (let y = 1; y < 299; y++)
        for (let x = 1; x < 399; x++) {
          const i = (y * 400 + x) * 4;
          let flat = Math.min(svg[i], svg[i + 1], svg[i + 2]) < 245;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(svg[i + c] - canvas[i + c]);
            error += d;
            for (const neighbor of [i - 4, i + 4, i - 1600, i + 1600])
              if (Math.abs(svg[i + c] - svg[neighbor + c]) > 1) flat = false;
          }
          if (flat) {
            interiorPixels++;
            for (let c = 0; c < 3; c++)
              maximumInteriorDifference = Math.max(
                maximumInteriorDifference,
                Math.abs(svg[i + c] - canvas[i + c]),
              );
          }
        }
      return {
        meanChannelDifference: error / (398 * 298 * 3),
        interiorPixels,
        maximumInteriorDifference,
      };
    }, images);
    assert.ok(
      difference.interiorPixels > (state === "expanding" ? 10 : 100),
      `${state}: missing visible rings`,
    );
    assert.ok(
      difference.maximumInteriorDifference <= 5,
      `${state}: overlap colors differ: ${JSON.stringify(difference)}`,
    );
    assert.ok(
      difference.meanChannelDifference < 0.5,
      `${state}: raster output differs: ${JSON.stringify(difference)}`,
    );
    results.push({ state, ...difference });
  }
  await page.evaluate(() => {
    window.drawing.destroy();
    window.drawingCanvas.remove();
  });
  return results;
}
