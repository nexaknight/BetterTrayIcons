import {Icon, action, media} from '../components/Icon.jsx';

const PC_APPS = ['telegram', 'steam', 'signal'];
const LAPTOP_APPS = ['discord', 'nextcloud'];

export function SyncScene() {
    return (
        <div
            className="sync-scene"
            role="img"
            data-i18n="aria-label"
            aria-label="A desktop PC and a laptop keep their tray settings in sync through a shared folder"
        >
            <span className="sync-parts" aria-hidden="true">
                <SyncDevice className="sync-pc" apps={PC_APPS} foot="sync-stand" />
                <span className="sync-line sync-line-left"><span className="sync-dot" /></span>
                <span className="sync-folder"><Icon src={action('folder')} /></span>
                <span className="sync-line sync-line-right"><span className="sync-dot" /></span>
                <SyncDevice className="sync-laptop" apps={LAPTOP_APPS} foot="sync-base" />
            </span>
        </div>
    );
}

function SyncDevice({className, apps, foot}) {
    return (
        <span className={`sync-device ${className}`}>
            <span className="sync-screen">
                <span className="sync-panel">
                    <span className="sync-activities" />
                    <span className="sync-tray">
                        {apps.map(app => <Icon key={app} src={media(`${app}.svg`)} />)}
                        <span className="sync-dots">•••</span>
                    </span>
                </span>
            </span>
            <span className={foot} />
        </span>
    );
}
