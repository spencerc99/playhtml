import { CanPlayProps, withSharedState } from "@playhtml/react";

interface ColorChange {
  color: string;
  timestamp: number;
}

interface Props {
  name: string;
}

function color(
  { data, setData }: CanPlayProps<{ colors: ColorChange[] }>,
  props: Props
) {
  props.name;
  return <div></div>;
}

export const Color = withSharedState(
  {
    defaultData: { colors: [] },
  },
  color
);

export const ColorInline = withSharedState(
  {
    defaultData: { colors: [] as ColorChange[] },
  },
  ({ data, setData }, props: Props) => {
    props.name;
    data.colors;
    return <div></div>;
  }
);
