// node:os for the browser build, only homedir is used (to look for launchers, which aren't there)
export const homedir = () => "/home/web";
export default { homedir };
