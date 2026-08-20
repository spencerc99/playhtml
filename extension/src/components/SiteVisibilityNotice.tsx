// ABOUTME: Shows the popup recovery action when the satchel is hidden on the current site.
// ABOUTME: Gives users a discoverable way to clear a saved site preference.

interface Props {
  siteName: string;
  onShowSatchel: () => void;
}

export function SiteVisibilityNotice({ siteName, onShowSatchel }: Props) {
  return (
    <section className="site-visibility-notice">
      <span>The satchel is hidden on {siteName}</span>
      <button type="button" onClick={onShowSatchel}>
        Show satchel on this site
      </button>
    </section>
  );
}
