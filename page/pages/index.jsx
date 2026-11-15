import Head from 'next/head';
import {Community} from '../sections/Community.jsx';
import {Features} from '../sections/Features.jsx';
import {Footer} from '../sections/Footer.jsx';
import {Hero} from '../sections/Hero.jsx';
import {Install} from '../sections/Install.jsx';

// Plain HTML out, the landing and demo runtime in public/ owns all behaviour
export const config = {unstable_runtimeJS: false};

export default function Home() {
    return (
        <>
            <Head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width,initial-scale=1" />
                <title data-i18n="">Better Tray Icons | System tray icons for GNOME Shell</title>
            </Head>
            <a className="skip" href="#main" data-i18n="">Skip to content</a>
            <main id="main">
                <Hero />
                <Features />
                <Install />
                <Community />
            </main>
            <Footer />
        </>
    );
}
