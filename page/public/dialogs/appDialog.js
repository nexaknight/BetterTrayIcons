import {openAlert} from '../components/alert.js';
import {smallButton} from '../components/button.js';
import {alertMarkup} from '../components/dialog.js';
import {group} from '../components/group.js';
import {CHEVRON, iconButton} from '../components/icon.js';
import {entryRow, row, rowIcon, spin, switchRow, toggleGroupRow} from '../components/row.js';
import {toast} from '../components/toast.js';
import {overlay} from '../components/window.js';
import {badge} from '../components/badge.js';
import {iconSubtitle} from '../components/emoji.js';
import {appById, appIconMarkup, presentApps} from '../shared/apps.js';
import {_} from '../shared/i18n.js';
import {refreshApps} from '../components/quickSettings.js';
import {APP_FIELDS, APP_FIELD_DEFAULTS, state} from '../shared/store.js';
import {escapeHtml} from '../shared/util.js';
import {views} from '../shared/views.js';

const APP_WHEN_IN_FRONT_OPTIONS = [['none', _('Default')], ['minimize', _('Minimize')], ['close', _('Close')]];
const APP_SCROLL_OPTIONS = [['default', _('Default')], ['forward', _('Forward')], ['nothing', _('None')]];
const APP_CONFIG_DEFAULTS = {hidden: false, whenInFront: 'none', scroll: 'default'};

export function confirmForgetApp(id) {
    openAlert({
        heading: _('Forget this app?'),
        body: _('Deletes all stored settings for this app.'),
        confirmLabel: _('Forget'),
        onConfirm: () => {
            delete state.appConfigs[id];
            refreshApps();
            views.closeModal();
            views.renderPage(true);
            toast(_('App forgotten'));
        },
    });
}

export function appContent(id) {
    const app = appById(id);
    state.appConfigs[id] ??= {name: app.name, ...APP_CONFIG_DEFAULTS};
    const config = state.appConfigs[id];
    for (const [field, key] of Object.entries(APP_FIELDS))
        state[`${key}-${id}`] = config[field] ?? APP_FIELD_DEFAULTS[field];
    const isForced = state.whenInFront !== 'none';
    if (isForced)
        state[`appWhenInFront-${id}`] = state.whenInFront;
    const present = presentApps();
    const position = present.indexOf(app) + 1;
    state[`appPosition-${id}`] = position;
    const nameRow = entryRow({id: 'native-app-name', label: _('Name'), value: config.name, attributes: `data-app-name="${id}"`, reset: {value: app.name, attributes: `data-reset-app-name="${id}"`}});
    const positionSubtitle = config.hidden
        ? _('Hidden icons have no position.')
        : _('Position %1 of %2, counted from the left.').replace('%1', String(position)).replace('%2', String(present.length));
    const configuration = nameRow +
        switchRow(_('Hide Icon'), `appHidden-${id}`, _('Don’t show this icon in the tray.')) +
        toggleGroupRow(_('Minimize Action for Unsupported Apps'), `appWhenInFront-${id}`, APP_WHEN_IN_FRONT_OPTIONS, {
            subtitle: isForced ? _('Set for every app on the General page.') : _('For apps that do not hide themselves when their icon is clicked while they are in front.'),
            badgeText: _('Experimental'),
            isSensitive: !isForced,
        }) +
        // A proxy has no app behind it that could take a wheel event, an
        // XEmbed window gets none from the tray
        (app.isBackgroundProxy || app.isXembed ? '' : toggleGroupRow(_('Scroll'), `appScroll-${id}`, APP_SCROLL_OPTIONS, {subtitle: _('Forward sends the mouse wheel to the app. Default follows the Actions page.')})) +
        spin(_('Position'), `appPosition-${id}`, 1, present.length, positionSubtitle) +
        (app.isXembed ? '' : customIconRow(id, app, config) + statusBadgeRow(id, config));
    const forget = row(_('Forget App'), _('Deletes all stored settings for this app.'), smallButton(_('Forget'), `data-forget-app="${id}"`, 'destructive'));
    return xembedNotice(app) + group(_('Configuration'), configuration, `${_('ID')}: ${id}`) + group(_('Danger Zone'), forget);
}

function xembedNotice(app) {
    if (!app.isXembed)
        return '';
    const flavor = app.packaging === 'Proton' ? _('Proton') : _('Wine');
    const text = `${flavor}: ${_('This app draws its tray icon itself via XEmbed. Custom icon and scroll settings do not apply here.')}`;
    return alertMarkup(text, {variant: 'warning'});
}

// The row opens the picker, its reset button sits inside, so the row is no
// button itself, as the activatable Adw.ActionRow in src/prefs/dialogs/appDialog.js
function customIconRow(id, app, config) {
    const reset = config.icon ? iconButton('reset', _('Reset icon'), `data-reset-app-icon="${id}"`) : '';
    const preview = rowIcon(appIconMarkup(app, 'aria-hidden="true"'), {color: app.color});
    return row(_('Custom Icon'), escapeHtml(iconSubtitle(config.icon, _('Default app icon'))), reset + CHEVRON, preview,
        `role="button" tabindex="0" data-native-icon-picker="app:${id}"`);
}

function statusBadgeRow(id, config) {
    if (!config.icon)
        return '';
    return row(_('Status Icons and Badges'), _('Unread badge and per-state icons.'), badge(_('Experimental')) + CHEVRON, '', `type="button" data-dialog="status:${id}"`);
}

export function resetAppIcon(id) {
    delete state.appConfigs[id].icon;
    refreshApps();
    views.renderPage(true);
    views.renderModal();
}

export function renameApp(id, name) {
    state.appConfigs[id].name = name;
    refreshApps();
    overlay.querySelector('[data-reset-app-name]').disabled = name === appById(id).name;
    views.renderPage(true);
}

export function resetAppName(id) {
    state.appConfigs[id].name = appById(id).name;
    refreshApps();
    views.renderPage(true);
    views.renderModal();
    // The reset goes disabled and drops focus, GTK leaves it on the dialog
    overlay.querySelector('.pref-dialog').focus({preventScroll: true});
}
