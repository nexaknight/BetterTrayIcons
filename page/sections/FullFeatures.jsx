import {CheckRow} from '../components/CheckRow.jsx';
import {action} from '../components/Icon.jsx';

// Each entry is the bold lead and the rest of the sentence, so the
// translated key reads "<strong>lead</strong>rest" like the page/po msgids
const FEATURES = [
    ['Three display modes', ': popup as a row or grid, folded into the panel, or simply inside Background Apps. You decide.'],
    ['Drag and drop', ' reordering, wherever the icons are'],
    ['Clicks, touch and scroll', ': decide what each one does.'],
    ['Scroll per app', ': scroll through the apps, and where an app supports it, its state or tray icon changes.'],
    ['Per-app overrides', ' to rename, hide, reorder or replace any icon'],
    ['Custom styling', ': your desktop, your style. Better Tray Icons never gets in your way, design it the way you like it.'],
    ['Icon and emoji picker', ': pick other icons or even emojis for your apps or the toggle button. It is your design.'],
    ['Automatic app detection', ': apps are listed as soon as they have been in the tray once. No tedious manual list. Adjust the settings per app whenever you need them.'],
    ['Tooltips', ': see which app that is, and give each one its own name.'],
    ['Symbolic icon mode', ' for a clean, native look where supported'],
    ['Background apps', ': hide them, put them in the tray, or move the tray in there.'],
    ['Sync between computers', ': keep your settings the same on all your devices. Whatever you change comes with you.'],
];

// Same markup as expanderMarkup in components/expander.js, which binds it
export function FullFeatures() {
    return (
        <div className="ui-expander full-features">
            <div
                className="ui-expander-header full-features-header"
                role="button"
                tabIndex={0}
                aria-expanded="false"
                data-expander="features"
            >
                <span data-i18n="">Show All Features</span>
                <span
                    className="pref-icon ui-expander-arrow"
                    aria-hidden="true"
                    style={{'--pref-icon': `url('${action('next')}')`}}
                />
            </div>
            <div className="ui-expander-body">
                <ul>
                    {FEATURES.map(([lead, rest]) => (
                        <CheckRow key={lead}><span data-i18n=""><strong>{lead}</strong>{rest}</span></CheckRow>
                    ))}
                </ul>
            </div>
        </div>
    );
}
