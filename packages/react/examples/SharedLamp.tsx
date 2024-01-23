import { CanToggleElement } from "@playhtml/react";

export function Lamp() {
  return (
    <CanToggleElement>
      {({ data }) => {
        const on = typeof data === "object" ? data.on : data;
        return (
          <img
            src="https://shop.noguchi.org/cdn/shop/products/1A_on_2048x.jpg?v=1567364979"
            selector-id=".lamp"
            className="lamp"
            id="lamp"
            style={{ opacity: on ? 1 : 0.5 }}
          />
        );
      }}
    </CanToggleElement>
  );
}
