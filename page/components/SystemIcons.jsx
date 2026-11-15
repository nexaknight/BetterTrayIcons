import {Icon, media} from './Icon.jsx';

// The qsGrid.js volume sync only looks inside #desktop, the mini panel copy
// carries the marker without effect
export function SystemIcons() {
    return (
        <>
            <Icon className="system-icon" src={media('network-wireless-signal-excellent-symbolic.svg')} />
            <Icon className="system-icon" data-volume-icon="" src={media('audio-volume-high-symbolic.svg')} />
            <Icon className="system-icon" src={media('system-shutdown-symbolic.svg')} />
        </>
    );
}
