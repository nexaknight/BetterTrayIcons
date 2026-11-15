import {Button} from '../components/Button.jsx';
import {media} from '../components/Icon.jsx';
import {SystemIcons} from '../components/SystemIcons.jsx';
import {OverflowPopup, TrayToggle} from '../components/Tray.jsx';

export function MiniTrayFeature() {
    return (
        <article className="feature feature-large">
            <div className="feature-text">
                <h3 data-i18n="">Keep the panel tidy</h3>
                <p data-i18n="">Show the icons you use every day and keep the rest one click away.</p>
            </div>
            <div className="real-tray">
                <div className="mini-tray-viewport">
                    <div className="mini-native" id="mini-native">
                        <div className="mini-wallpaper" />
                        <OverflowPopup id="mini-popup" hidden />
                        <div className="mini-panel">
                            <div className="mini-tray-group">
                                <TrayToggle
                                    label="Toggle miniature overflow"
                                    popup="mini-popup"
                                    isExpanded={false}
                                />
                                <div className="mini-visible" id="mini-visible" />
                            </div>
                            <div className="panel-system" data-i18n="aria-label" aria-label="Quick settings">
                                <SystemIcons />
                            </div>
                            <time className="panel-date mini-clock" />
                            <Button
                                as="button"
                                className="mini-show-desktop"
                                data-i18n="aria-label title"
                                aria-label="Show miniature desktop"
                                tooltip="Show desktop"
                            />
                        </div>
                        <img
                            className="mini-cursor"
                            src={media('cursor-default.png')}
                            alt=""
                            width="32"
                            height="32"
                            hidden
                        />
                    </div>
                </div>
            </div>
        </article>
    );
}
