// install react-resizable and add to package.json
import { Resizable } from "react-resizable";
import { CanPlayElement } from "@playhtml/react";
import "react-resizable/css/styles.css";

export function CanResizeElement({
  children,
  initialWidth,
  initialHeight,
}: {
  children: SingleChildOrPlayable;
  initialWidth?: number;
  initialHeight?: number;
}) {
  return (
    <CanPlayElement
      defaultData={{
        width: initialWidth,
        height: initialHeight,
      }}
      children={(renderData) => {
        const { data, setData } = renderData;
        const { width, height } = data;
        const renderedChildren = renderSingleChildOrPlayable(
          children,
          renderData
        );

        return (
          <Resizable
            width={width || initialWidth || undefined}
            height={height || initialHeight || undefined}
            lockAspectRatio
            onResize={(e, d) => {
              setData({
                width: d.size.width,
                height: d.size.height,
              });
            }}
            children={React.cloneElement(
              React.Children.only(renderedChildren) as any,
              {
                style: {
                  ...renderedChildren?.props.style,
                  width: `${width}px`,
                  height: `${height}px`,
                },
              }
            )}
          ></Resizable>
        );
      }}
    />
  );
}
