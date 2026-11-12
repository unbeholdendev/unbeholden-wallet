import { useState } from "react";
import { useVault } from "../../app/vault";
import { Notice, Panel } from "../../ui/kit";

export function Notifications() {
  const { settings, saveSettings } = useVault();
  const [blocked, setBlocked] = useState(false);
  if (typeof Notification === "undefined")
    return (
      <Panel title="Notifications">
        <p className="m-0 text-sm text-ink-3">This browser can't show notifications.</p>
      </Panel>
    );
  const toggle = async (on: boolean) => {
    const allowed = !on || (await Notification.requestPermission()) === "granted";
    setBlocked(!allowed);
    if (allowed) await saveSettings({ notify: on });
  };
  return (
    <Panel title="Notifications">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!settings.notify}
          onChange={(e) => void toggle(e.target.checked)}
          className="size-4 accent-carbon"
        />
        Tell me when a payment arrives and when it confirms
      </label>
      <p className="m-0 text-sm text-ink-2">
        Only while this app is open and unlocked. The browser shows them itself; nothing is sent anywhere. They say a
        payment arrived, not how much, as they can stay on the lock screen.
      </p>
      {blocked && (
        <Notice tone="warn">
          The browser has blocked notifications for this site. Allow them in its site settings, then try again.
        </Notice>
      )}
    </Panel>
  );
}
