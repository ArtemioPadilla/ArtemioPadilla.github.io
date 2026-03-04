/** Unique identifier for a heap object, derived from Python's id() */
export type HeapObjectId = string;

/** Primitive Python values stored inline */
export type PrimValue =
  | { type: "int"; value: number }
  | { type: "float"; value: number }
  | { type: "str"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "none" }
  | { type: "ref"; id: HeapObjectId };

/** A variable binding: name → value or reference */
export interface Variable {
  name: string;
  value: PrimValue;
}

/** A stack frame captured at one execution step */
export interface StackFrame {
  funcName: string;
  locals: Variable[];
  lineNumber: number;
  isHighlighted: boolean;
}

/** Heap objects: containers and class instances */
export type HeapObject =
  | { type: "list"; id: HeapObjectId; elements: PrimValue[] }
  | { type: "tuple"; id: HeapObjectId; elements: PrimValue[] }
  | { type: "set"; id: HeapObjectId; elements: PrimValue[] }
  | {
      type: "dict";
      id: HeapObjectId;
      entries: { key: PrimValue; value: PrimValue }[];
    }
  | {
      type: "instance";
      id: HeapObjectId;
      className: string;
      attrs: Variable[];
    }
  | {
      type: "function";
      id: HeapObjectId;
      name: string;
      params: string[];
    }
  | { type: "other"; id: HeapObjectId; repr: string };

/** One step in the execution trace */
export interface TraceStep {
  stepIndex: number;
  event: "call" | "line" | "return" | "exception";
  lineNumber: number;
  stack: StackFrame[];
  heap: Record<HeapObjectId, HeapObject>;
  stdout: string;
  exceptionMsg?: string;
}

/** Complete execution trace */
export interface ExecutionTrace {
  code: string;
  steps: TraceStep[];
  error?: string;
}
