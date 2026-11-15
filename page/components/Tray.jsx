import {Button} from './Button.jsx';

// public/landing/elements.js and miniTray.js find the icon box by the popup id plus -icons
export function OverflowPopup({id, ...rest}) {
    return (
        <div className="overflow" id={id} {...rest}>
            <div className="overflow-icons" id={`${id}-icons`} />
        </div>
    );
}

export function TrayToggle({id, label, popup, isExpanded, leading}) {
    return (
        <Button
            as="button"
            className="tray-toggle"
            id={id}
            data-i18n="aria-label"
            aria-label={label}
            aria-expanded={String(isExpanded)}
            aria-controls={popup}
            leading={leading}
        />
    );
}
