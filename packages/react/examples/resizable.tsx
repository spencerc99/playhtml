// install react-resizable and add to package.json
import React, { PropsWithChildren } from "react";
import { Resizable } from "react-resizable";
import { withSharedState } from "@playhtml/react";
import "react-resizable/css/styles.css";

interface Props {
  initialWidth: number;
  initialHeight: number;
  onResize?: (newWidth: number, newHeight: number) => void;
}

export const CanResizeElement = withSharedState(
  ({ initialWidth, initialHeight }) => ({
    defaultData: {
      width: initialWidth,
      height: initialHeight,
    },
  }),
  ({ data, setData }, props: PropsWithChildren<Props>) => {
    const { onResize, children } = props;
    const { width, height } = data;
    return (
      <Resizable
        width={width}
        height={height}
        lockAspectRatio
        onResize={(e, d) => {
          setData((state) => {
            state.width = d.size.width;
            state.height = d.size.height;
          });
          onResize?.(d.size.width, d.size.height);
        }}
      >
        <div
          style={{
            width,
            height,
          }}
        >
          {children}
        </div>
      </Resizable>
    );
  }
);
