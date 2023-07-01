// Supported Tags
export enum TagType {
  "CanMove" = "can-move",
  "CanSpin" = "can-spin",
}

const TagMessageType = Object.keys(TagType).map((k) => `${k}Message` as const);

// export interface Message {
//   type: (typeof TagMessageType)[number];
// }

export enum MessageType {
  Position = "position",
  Rotation = "rotation",
}

interface MessageMap {
  [MessageType.Position]: {
    type: MessageType.Position;
    id: string;
    x: number;
    y: number;
  };
  [MessageType.Rotation]: {
    type: MessageType.Rotation;
    id: string;
    rotation: string;
  };
}
export type Message = MessageMap[MessageType];
