import {isDisposed} from '../disposal.js';
import {clearIds, debounceTo, removeTimer} from '../../shared/lifecycle.js';
import {clearShownIcons, publishShownIcons} from '../../shared/appConfig.js';

// Longer than a status flip of a flapping item, so a burst ends in one write.
const SHOWN_ICONS_PUBLISH_DELAY_MS = 500;

// The watchers keep one sink for their whole life, so the display mode can
// swap the renderer behind it without restarting them.
export class TraySink {
    constructor() {
        this._icons = new Map();
        this._renderer = null;
        this._shownIconsPublishId = 0;
    }

    addIcon(id, actor) {
        if (this._icons.has(id))
            return;
        this._icons.set(id, actor);
        this._renderer.addIcon(id, actor);
    }

    removeIcon(id) {
        if (!this._icons.delete(id))
            return;
        this._renderer.removeIcon(id);
        this.queueShownIconsPublish();
    }

    // Lives on the sink, not a renderer, so it keeps going while the display
    // mode swaps the renderer.
    queueShownIconsPublish() {
        debounceTo(this, '_shownIconsPublishId', SHOWN_ICONS_PUBLISH_DELAY_MS,
            () => publishShownIcons(this._shownIcons()));
    }

    _shownIcons() {
        const icons = {};
        for (const actor of this._icons.values()) {
            if (actor._appId && actor._shownIcon)
                icons[actor._appId] = actor._shownIcon;
        }
        return icons;
    }

    // A renderer destroys whatever still sits in its boxes, so the icons leave
    // before the old one goes.
    setRenderer(renderer) {
        for (const actor of this._icons.values()) {
            if (!isDisposed(actor))
                actor.get_parent()?.remove_child(actor);
        }
        this._renderer = renderer;
        for (const [id, actor] of this._icons)
            renderer?.addIcon(id, actor);
    }

    _handleIconClick(actor) {
        this._renderer._handleIconClick(actor);
    }

    queueUpdateLayout() {
        this._renderer.queueUpdateLayout();
    }

    _onAnyDragBegin() {
        this._renderer._onAnyDragBegin();
    }

    _onAnyDragEnd() {
        this._renderer._onAnyDragEnd();
    }

    destroy() {
        clearIds(this, removeTimer, '_shownIconsPublishId');
        clearShownIcons();
    }
}
