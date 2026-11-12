import { OniStudioAppShell } from './ui/appShell';

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app container missing');
  new OniStudioAppShell(root);
});
