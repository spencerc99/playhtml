// install react-resizable and add to package.json
import React, { PropsWithChildren } from "react";
import { Resizable } from "react-resizable";
import { withPlay } from "@playhtml/react";
import "react-resizable/css/styles.css";

interface Props {
  initialWidth: number;
  initialHeight: number;
  onResize: (newWidth: number, newHeight: number) => void;
}

export const CanResizeElement = withPlay<PropsWithChildren<Props>>()(
  ({ initialWidth, initialHeight }) => ({
    defaultData: {
      width: initialWidth,
      height: initialHeight,
    },
  }),
  ({ props, data, setData }) => {
    const { onResize, children } = props;
    const { width, height } = data;
    return (
      <Resizable
        width={width}
        height={height}
        lockAspectRatio
        onResize={(e, d) => {
          setData({
            width: d.size.width,
            height: d.size.height,
          });
          onResize(d.size.width, d.size.height);
        }}
      >
        {children}
      </Resizable>
    );
  }
);
