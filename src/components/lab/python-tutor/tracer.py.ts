export const TRACER_CODE = `
import sys
import json

_trace_steps = []
_stdout_buffer = []
_max_steps = 1000
_user_code_filename = "<user_code>"
_step_count = 0

class _TooManyStepsError(Exception):
    pass

def _encode_value(val, heap, seen_ids, depth=0):
    if depth > 8:
        return {"type": "str", "value": repr(val)[:100]}
    if val is None:
        return {"type": "none"}
    if isinstance(val, bool):
        return {"type": "bool", "value": val}
    if isinstance(val, int):
        if -2**53 < val < 2**53:
            return {"type": "int", "value": val}
        return {"type": "str", "value": str(val)}
    if isinstance(val, float):
        return {"type": "float", "value": val}
    if isinstance(val, str):
        return {"type": "str", "value": val[:500]}

    obj_id = str(id(val))
    ref = {"type": "ref", "id": obj_id}

    if obj_id in seen_ids:
        return ref
    seen_ids.add(obj_id)

    if isinstance(val, list):
        elements = [_encode_value(e, heap, seen_ids, depth+1) for e in val[:50]]
        heap[obj_id] = {"type": "list", "id": obj_id, "elements": elements}
    elif isinstance(val, tuple):
        elements = [_encode_value(e, heap, seen_ids, depth+1) for e in val[:50]]
        heap[obj_id] = {"type": "tuple", "id": obj_id, "elements": elements}
    elif isinstance(val, set):
        elements = [_encode_value(e, heap, seen_ids, depth+1) for e in list(val)[:50]]
        heap[obj_id] = {"type": "set", "id": obj_id, "elements": elements}
    elif isinstance(val, dict):
        entries = []
        for k, v in list(val.items())[:50]:
            entries.append({
                "key": _encode_value(k, heap, seen_ids, depth+1),
                "value": _encode_value(v, heap, seen_ids, depth+1)
            })
        heap[obj_id] = {"type": "dict", "id": obj_id, "entries": entries}
    elif hasattr(val, "__dict__") and not isinstance(val, type):
        attrs = []
        for attr_name, attr_val in list(vars(val).items())[:30]:
            if not attr_name.startswith("_"):
                attrs.append({
                    "name": attr_name,
                    "value": _encode_value(attr_val, heap, seen_ids, depth+1)
                })
        heap[obj_id] = {
            "type": "instance", "id": obj_id,
            "className": type(val).__name__, "attrs": attrs
        }
    elif callable(val) and hasattr(val, "__name__"):
        try:
            import inspect
            params = list(inspect.signature(val).parameters.keys())
        except (ValueError, TypeError):
            params = []
        heap[obj_id] = {"type": "function", "id": obj_id, "name": val.__name__, "params": params}
    else:
        heap[obj_id] = {"type": "other", "id": obj_id, "repr": repr(val)[:200]}

    return ref


def _capture_frame_stack(frame):
    frames = []
    f = frame
    while f is not None:
        if f.f_code.co_filename == _user_code_filename:
            frames.append(f)
        f = f.f_back
    frames.reverse()
    return frames


def _snapshot(frame, event):
    global _step_count
    _step_count += 1
    if _step_count > _max_steps:
        raise _TooManyStepsError("Exceeded maximum steps")

    raw_frames = _capture_frame_stack(frame)
    heap = {}
    seen_ids = set()
    stack = []

    _skip_names = frozenset((
        "__builtins__", "__name__", "__doc__", "__package__",
        "__loader__", "__spec__", "__annotations__", "__cached__",
        "_TooManyStepsError", "_trace_func", "_snapshot",
        "_capture_frame_stack", "_encode_value", "_custom_print",
        "__builtins_print__", "_trace_steps", "_stdout_buffer",
        "_max_steps", "_user_code_filename", "_step_count",
        "run_with_trace", "_skip_names",
    ))

    for i, f in enumerate(raw_frames):
        is_top = (i == len(raw_frames) - 1)
        local_vars = []
        for name, val in sorted(f.f_locals.items()):
            if name in _skip_names:
                continue
            if name.startswith("__") and name.endswith("__"):
                continue
            local_vars.append({
                "name": name,
                "value": _encode_value(val, heap, seen_ids)
            })
        stack.append({
            "funcName": f.f_code.co_name if f.f_code.co_name != "<module>" else "Global",
            "locals": local_vars,
            "lineNumber": f.f_lineno,
            "isHighlighted": is_top
        })

    step = {
        "stepIndex": _step_count - 1,
        "event": event,
        "lineNumber": frame.f_lineno,
        "stack": stack,
        "heap": heap,
        "stdout": "".join(_stdout_buffer),
    }
    _trace_steps.append(step)


def _trace_func(frame, event, arg):
    if frame.f_code.co_filename != _user_code_filename:
        return None
    if event == "call":
        _snapshot(frame, "call")
        return _trace_func
    elif event == "line":
        _snapshot(frame, "line")
        return _trace_func
    elif event == "return":
        _snapshot(frame, "return")
        return _trace_func
    elif event == "exception":
        exc_type, exc_value, exc_tb = arg
        _snapshot(frame, "exception")
        _trace_steps[-1]["exceptionMsg"] = str(exc_value)
        return _trace_func
    return _trace_func


def _custom_print(*args, **kwargs):
    import io
    buf = io.StringIO()
    kwargs["file"] = buf
    __builtins_print__(*args, **kwargs)
    text = buf.getvalue()
    _stdout_buffer.append(text)

__builtins_print__ = print


def run_with_trace(code_str):
    global _trace_steps, _stdout_buffer, _step_count
    _trace_steps = []
    _stdout_buffer = []
    _step_count = 0

    error = None
    compiled = compile(code_str, _user_code_filename, "exec")
    namespace = {"print": _custom_print, "__name__": "__main__"}

    sys.settrace(_trace_func)
    try:
        exec(compiled, namespace)
    except _TooManyStepsError:
        error = "Execution exceeded maximum steps (1000). Showing partial trace."
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
    finally:
        sys.settrace(None)

    result = {"code": code_str, "steps": _trace_steps}
    if error:
        result["error"] = error
    return json.dumps(result)
`;
