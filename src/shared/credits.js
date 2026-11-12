export const DBUS_SPECS = Object.freeze([
    {name: 'StatusNotifierItem', url: 'https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/StatusNotifierItem/'},
    {name: 'StatusNotifierWatcher', url: 'https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/StatusNotifierWatcher/'},
    {name: 'com.canonical.dbusmenu', url: 'https://launchpad.net/libdbusmenu'},
]);

// Each process hands in its own gettext, xgettext still finds the strings here.
export function inspirationLinks(_) {
    return [
        {
            name: 'AppIndicator and KStatusNotifierItem Support',
            url: 'https://github.com/ubuntu/gnome-shell-extension-appindicator',
            about: _('• StatusNotifierItem and dbusmenu support in GNOME Shell\n• The interface specifications it links to'),
        },
        {
            name: 'Tray Icons: Reloaded',
            url: 'https://github.com/MartinPL/Tray-Icons-Reloaded',
            about: _('• Inspiration for the overflow popup\n• Code studied as a reference'),
        },
        {
            name: 'Background App Icons',
            url: 'https://github.com/cassidyjames/background-app-icons',
            about: _('• Tray icons for windowless background apps'),
        },
        {
            name: 'Dash to Panel',
            url: 'https://github.com/home-sweet-gnome/dash-to-panel',
            about: _('• Cues for the layout of the About page'),
        },
    ];
}
