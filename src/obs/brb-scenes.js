export function createBrbSceneController({ pipeline, getBreakScene }) {
  let wasInBreakScene = false;
  return sceneName => {
    const selected = getBreakScene();
    const isBreakScene = Boolean(selected && selected === sceneName);
    if (isBreakScene && !wasInBreakScene) {
      wasInBreakScene = true;
      return pipeline.startBrbBreak();
    }
    if (!isBreakScene && wasInBreakScene) {
      wasInBreakScene = false;
      return pipeline.endBrbBreak();
    }
    return null;
  };
}
