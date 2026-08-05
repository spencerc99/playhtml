// ABOUTME: Declares the inline state editing helpers exported by the playhtml subpath.
// ABOUTME: Re-exports the generated core package declarations for package consumers.
export {
  formatStateLeafValue,
  isEditableStateLeaf,
  parseStateLeafValue,
  replaceStateLeafValue,
} from "./dist/main";

export type {
  EditableStateLeafValue,
  StatePathSegment,
} from "./dist/main";
