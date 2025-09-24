import { CanToggleElement } from "@playhtml/react";
import React from "react";

export function SharedLamp({
  src = "https://shop.noguchi.org/cdn/shop/products/1A_on_2048x.jpg?v=1567364979",
  shared,
  dataSource,
  id,
}: {
  src?: string;
  shared?: boolean;
  dataSource?: string;
  id?: string;
}) {
  return (
    <CanToggleElement shared={shared} dataSource={dataSource}>
      {({ data }) => {
        const on = typeof data === "object" ? data.on : data;
        return (
          <img
            id={id}
            src={src}
            selector-id=".lamp"
            className="lamp"
            style={{
              filter: on
                ? `brightness(1.2) saturate(1.6)
      drop-shadow(0px 0px 50px rgba(247, 220, 156, 0.85))`
                : "",
            }}
          />
        );
      }}
    </CanToggleElement>
  );
}
