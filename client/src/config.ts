/** Runtime branding config injected by the server entrypoint as window.__YOKE_CONFIG__. */
export interface YokeConfig {
  repoUrl: string;
  feedbackUrl: string;
  extensionUrl: string;
  hideGithub: boolean;
  hideExtension: boolean;
  hideCli: boolean;
}

const defaults: YokeConfig = {
  repoUrl: "https://github.com/yokedotlol/yoke",
  feedbackUrl: "https://github.com/yokedotlol/yoke/issues",
  extensionUrl: "https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj",
  hideGithub: false,
  hideExtension: false,
  hideCli: false,
};

declare global {
  interface Window {
    __YOKE_CONFIG__?: Partial<YokeConfig>;
  }
}

export function getConfig(): YokeConfig {
  return { ...defaults, ...(window.__YOKE_CONFIG__ || {}) };
}
