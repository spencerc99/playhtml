import "../home.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";

const ExperimentNumber = 4;

const Experiments: Record<number, any> = {
  1: {
    slug: "one",
  },
  2: { slug: "two" },
};

function padZero(str) {
  var zeros = new Array(2).join("0");
  return (zeros + str).slice(-2);
}

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      marginTop: "4em",
    }}
  >
    <h1>playhtml experiments</h1>
    <p>
      a series of experiments playing with how playhtml can change the texture
      of the web. All code available on{" "}
      <a href="https://github.com/spencerc99/playhtml/blob/main/website/experiments/">
        github
      </a>
      .
    </p>
    <ol>
      {Array.from({ length: ExperimentNumber }, (v, i) => i).map((index) => {
        const info = Experiments[index + 1];
        const { slug, title } = info || { slug: index + 1, title: undefined };
        const href = `/experiments/${slug}/`;
        return (
          <li key={slug}>
            <a href={href}>{title || `experiment "${padZero(index + 1)}"`}</a>
          </li>
        );
      })}
    </ol>
  </div>
);
