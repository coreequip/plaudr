import { detectOs, type Platform } from './platform';

/** Browser: Dateien über Download und Dateiwahl, kein Zustand nach außen. */
export function webPlatform(): Platform {
  return {
    kind: 'web',
    os: detectOs(),
    async saveText(fileName, text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    },
    // Nur für Aufrufer ohne sichtbares Dateifeld; die Sicherungskarte im Browser liest #restore-file selbst.
    openText(accept) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept.join(',');
        input.hidden = true;
        input.onchange = async () => {
          const f = input.files?.[0];
          input.remove();
          resolve(f ? { name: f.name, text: await f.text() } : null);
        };
        input.oncancel = () => {
          input.remove();
          resolve(null);
        };
        document.body.append(input);
        input.click();
      });
    },
    update() {},
  };
}
