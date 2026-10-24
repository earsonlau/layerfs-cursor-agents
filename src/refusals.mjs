/**
 * What a Cursor agent does after one refused LayerFS call.
 * This function does not call LayerFS. It never says to replay the refused call.
 *
 * @param {{ code?: string, message?: string, detail?: unknown }} error
 */
export function refusalPlan(error) {
  const code = typeof error?.code === "string" ? error.code : "Unknown";
  const base = {
    code,
    retry: false,
    replay: false,
  };
  if (code === "Conflict") {
    return {
      ...base,
      action: "inspect-once",
      steps: [
        "Do not send the refused call again.",
        "Read detail once. A workspace.commit conflict leaves markers in that same Workspace; do not mount another Workspace to see them.",
        "Resolve the files in that Workspace, then workspace.commit once with the resolved tree. That commit is a new call. If it is also refused, stop and report.",
        "A branch.merge conflict writes nothing. Resolve on working forks, then merge the forks once. If that merge is refused, stop and report.",
      ],
    };
  }
  if (code === "Busy") {
    return {
      ...base,
      action: "stop",
      steps: [
        "A lock or an existing worker is held. The call already waited. Do not call it again.",
        "Report code, message, and detail.",
      ],
    };
  }
  if (code === "NoSuchSandbox") {
    const detail = error?.detail && typeof error.detail === "object" ? error.detail : {};
    if (detail.containerGone || detail.containerStopped) {
      return {
        ...base,
        action: "stop",
        steps: [
          "The Sandbox container is gone or stopped, and every Workspace in it is gone with it.",
          "Do not mount that sandbox id again, and do not start a replacement unless the user asks.",
          "Report code, message, and detail.",
        ],
      };
    }
    return {
      ...base,
      action: "create-once",
      steps: [
        "Do not mount, exec, commit, or unmount that sandbox id again.",
        "Call sandbox.create() once. If that call is refused, stop and report it.",
        "Mount the new sandbox id once. If that mount is refused, stop and report it.",
      ],
    };
  }
  if (code === "HeadMoved") {
    return {
      ...base,
      action: "reread-once",
      steps: [
        "Do not send the same write again.",
        "Read the file once. If the task still needs a change, make one new edit. If that edit is refused, stop and report.",
      ],
    };
  }
  if (code === "Unknown" || code === "Failed") {
    return {
      ...base,
      action: "inspect-outcome",
      steps: [
        "The outcome is uncertain. Do not redo the operation.",
        "Look once with branch.list_commits and fs.read, then report what you found.",
      ],
    };
  }
  return {
    ...base,
    action: "stop",
    steps: ["Do not retry or replay the call. Report code, message, and detail."],
  };
}
