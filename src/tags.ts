// import { TagType, TagTypeToElement } from "./types";
// import * as Y from "yjs";

// TODO: complete this and migrate from the simple setup method to reduce repeated code
// abstract class BaseTagManager<V extends TagType> {
//   elementMap: Y.Map<TagTypeToElement[V]>;
//   elementHandler: Map<string, TagTypeToElement[V]>;

//   constructor(doc: Y.Doc, tagType: V, elements: HTMLElement[]) {
//     this.elementMap = doc.getMap(tagType);
//     this.elementHandler = new Map<string, TagTypeToElement[V]>();

//     for (const ele of elements) {
//       const elementId = getIdForElement(ele);
//       const savedData = this.elementMap.get(elementId);
//       this.elementHandler.set(
//         elementId,
//         this.createElement(elementId, savedData)
//       );
//     }

//     this.elementMap.observe((event) => {});
//   }

//   abstract updateElementInfo(
//     elementId: string,
//     newData: TagTypeToElement[V]["data"]
//   ): void;
//   createElement(
//     elementId: string,
//     data: TagTypeToElement[V]["data"]
//   ): TagTypeToElement[V];
//   abstract setup: (elements: HTMLElement[]) => void;
// }

// What is the minimal set of "handlers" that create the most flexibility to
// onclick
// ondrag - combination of clicked and onmousemove
// onhover

/*
// alternatively the wish / listen method
// wish="can-move"
// wish={e => {
      
}}

*/
