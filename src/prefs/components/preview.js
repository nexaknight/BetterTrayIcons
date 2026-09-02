import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {connectScoped} from '../../shared/lifecycle.js';
import {COLOR_VARIANT_KEY} from '../../shared/colorVariant.js';
import {bindGuideOverlay, createGuideToggle} from './guide.js';
import {editsLightFor} from './scenes/sceneInk.js';
import {ensurePrefsCss} from './text.js';

// The stage keeps this height whatever the sample needs, so the rows below stay
// put while spacing is edited. A larger sample is clipped, centered.
export const PREVIEW_STAGE_HEIGHT_PX = Object.freeze({panel: 104, popup: 160});

let _instanceCount = 0;

// The guides area covers the whole stage and stays out of picking, so the
// sample keeps its hover states.
const PreviewStage = GObject.registerClass({GTypeName: 'BetterTrayIconsPreviewStage'},
    class PreviewStage extends Gtk.Widget {
        _init(height) {
            super._init({
                css_classes: ['bti-preview-backdrop'],
                overflow: Gtk.Overflow.HIDDEN,
                hexpand: true,
            });
            this._height = height;
            this._sample = null;
            this._guides = new Gtk.DrawingArea({can_target: false, visible: false});
            this._guides.set_parent(this);
        }

        get guides() {
            return this._guides;
        }

        setSample(widget) {
            this._sample?.unparent();
            this._sample = widget;
            widget.insert_before(this, this._guides);
        }

        vfunc_measure(orientation, _forSize) {
            return orientation === Gtk.Orientation.VERTICAL
                ? [this._height, this._height, -1, -1]
                : [0, 0, -1, -1];
        }

        vfunc_size_allocate(width, height, _baseline) {
            if (this._sample) {
                const [, sampleWidth] = this._sample.measure(Gtk.Orientation.HORIZONTAL, -1);
                const [, sampleHeight] = this._sample.measure(Gtk.Orientation.VERTICAL, sampleWidth);
                this._sample.size_allocate(new Gdk.Rectangle({
                    x: Math.round((width - sampleWidth) / 2),
                    y: Math.round((height - sampleHeight) / 2),
                    width: sampleWidth,
                    height: sampleHeight,
                }), -1);
            }
            this._guides.size_allocate(new Gdk.Rectangle({x: 0, y: 0, width, height}), -1);
        }

        vfunc_dispose() {
            this._sample?.unparent();
            this._sample = null;
            this._guides?.unparent();
            this._guides = null;
            super.vfunc_dispose();
        }
    });

export function createPreviewGroup({settings, watch, render, splitKey, stageHeight = PREVIEW_STAGE_HEIGHT_PX.panel}) {
    ensurePrefsCss();
    const toggles = new Gtk.Box({spacing: 4});
    toggles.append(createGuideToggle(settings, 'padding', _('Measure the padding while hovering the preview.')));
    toggles.append(createGuideToggle(settings, 'margin', _('Measure the margin while hovering the preview.')));
    const group = new Adw.PreferencesGroup({title: _('Preview'), header_suffix: toggles});
    const stage = new PreviewStage(stageHeight);
    group.add(stage);

    // Class names are display-global, every preview instance styles its own.
    const scopeClass = `bti-preview-${_instanceCount++}`;
    stage.add_css_class(scopeClass);
    const provider = new Gtk.CssProvider();
    const display = Gdk.Display.get_default();
    // Cleanup rides unrealize, destroy waits on the GC in GJS and never fires
    // in the shared prefs service, which leaks one display-global provider per
    // subpage visit.
    let isAttached = false;
    const attach = () => {
        if (isAttached)
            return;
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        isAttached = true;
    };
    attach();
    group.connect('realize', attach);
    group.connect('unrealize', () => {
        if (!isAttached)
            return;
        Gtk.StyleContext.remove_provider_for_display(display, provider);
        isAttached = false;
    });

    const showGuides = bindGuideOverlay(group, stage, settings);

    const apply = () => {
        const rendered = render(settings, scopeClass);
        stage.setSample(rendered.widget);
        showGuides(rendered.guides);
        if (editsLightFor(settings, splitKey))
            stage.add_css_class('light');
        else
            stage.remove_css_class('light');
        provider.load_from_string(rendered.css);
    };

    connectScoped(group, Adw.StyleManager.get_default(), 'notify::accent-color', apply);
    [...watch, COLOR_VARIANT_KEY]
        .forEach(key => connectScoped(group, settings, `changed::${key}`, apply));
    apply();

    return group;
}
