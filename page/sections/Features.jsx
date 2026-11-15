import {Button} from '../components/Button.jsx';
import {Feature} from '../components/Feature.jsx';
import {Icon, media} from '../components/Icon.jsx';
import {MiniTrayFeature} from './MiniTrayFeature.jsx';
import {SyncScene} from './SyncScene.jsx';
import {FullFeatures} from './FullFeatures.jsx';

// The nth-child rules of styles/landing/_styleSamples.scss give each copy its own look
const STYLE_SAMPLE_COUNT = 3;
const SHORTCUTS = [
    {id: 'click', label: 'Click', tooltip: 'Open Left Click settings'},
    {id: 'double', label: 'Double-click', tooltip: 'Open Double Click settings'},
    {id: 'long', label: 'Long-press', tooltip: 'Open Long Press settings'},
    {id: 'touch', label: 'Touch', tooltip: 'Open Touch settings'},
    {id: 'scroll', label: 'Scroll', tooltip: 'Open Scroll settings'},
];

export function Features() {
    return (
        <section className="features-section wrap" id="features">
            <div className="section-heading">
                <div><h2 data-i18n="">Your tray icons, back</h2></div>
                <p data-i18n="">
                    Discord, Steam, Telegram, Signal and Nextcloud are back. Legacy X11
                    tray apps such as Wine and Proton games come along, and windowless
                    background apps get an icon too.
                </p>
            </div>
            <div className="feature-grid">
                <MiniTrayFeature />
                <Feature
                    icon="properties"
                    title="Set up each app"
                    text="Rename an app, swap its icon or hide it. Adjust spacing, padding and colors to match your panel."
                >
                    <StyleSamples />
                </Feature>
                <Feature
                    icon="actions"
                    title="Choose what clicks do"
                    text="Mouse, touch and scroll wheel, every input gets the action you want."
                >
                    <div className="shortcut-tags" data-i18n="aria-label" aria-label="Explore input settings">
                        {SHORTCUTS.map(shortcut => (
                            <Button
                                key={shortcut.id}
                                variant="compact"
                                href="#explore"
                                data-pref-shortcut={shortcut.id}
                                data-i18n="html data-pref-tooltip"
                                data-pref-tooltip={shortcut.tooltip}
                                title={shortcut.label}
                            />
                        ))}
                    </div>
                </Feature>
                <Feature
                    className="feature-sync"
                    icon="sync"
                    title="Sync your setup"
                    text="Export your settings to a file and import them on another computer. Or keep several computers in sync through a shared JSON file with automatic backups."
                >
                    <Button
                        as="button"
                        type="button"
                        variant="secondary"
                        data-open-tab="sync"
                        data-i18n=""
                        title="Open Sync Settings"
                    />
                    <SyncScene />
                </Feature>
            </div>
            <FullFeatures />
        </section>
    );
}

function StyleSamples() {
    return (
        <div className="style-samples">
            {Array.from({length: STYLE_SAMPLE_COUNT}, (_unused, index) => (
                <Button
                    key={index}
                    as="button"
                    type="button"
                    data-open-app="steam"
                    data-i18n="aria-label data-pref-tooltip"
                    aria-label="Configure Steam in the preferences"
                    data-pref-tooltip="Configure Steam"
                    leading={<Icon src={media('steam.svg')} />}
                />
            ))}
        </div>
    );
}
