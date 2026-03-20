const fs = require('fs');
const path = require('path');

const text = `61578035714423|mactriminh7514|26TJJTN6KYFRXVXJ2ABBPTS6LG6KAEYH|c_user=61578035714423;xs=24:LMDnSGUoXOiTtA:2:1752452885:-1:-1;presence=C%7B%22t3%22%3A%5B%5D%2C%22utc3%22%3A1753616982701%2C%22v%22%3A1%7D;fr=1LErOR23xooXAs4UR.AWe0RtKMJCeBTDheQKPuWQHXCn-Lar5VZFd6wfOFlClWRqWtFi8.BodE8I..AAA.0.0.BohhJU.AWe3KMJ9ndOeQdiD4AqQN0XdtQk;wd=1056x600;datr=Rk50aC_DHMFP2FXqTPmufJJL;ps_l=1;locale=vi_VN;pas=61578035714423%3AJ5ILru3dL7;sb=ceuFaBtTU1EVKnFtZ88ag0vX;wl_cbv=v2%3Bclient_version%3A2880%3Btimestamp%3A1753607040;ps_n=1;dpr=0.22140221297740936;fbl_st=101439822%3BT%3A29226784;useragent=TW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzExMS4wLjkyODAuODcgU2FmYXJpLzUzNy4zNg%3D%3D|EAAAAUaZA8jlABPIIFcboRZCldVXePmrPKFyXjDdQbZCrSTfIPvIEsOlY1EWTBw90INOJzR1ph7xzcZAY5tC3D2XZBHS2zy63uIsMwZADKZBgg3ry4SLzpA34kI9oBq0S6nIAN9op8EX9FshOuncAUIo4D9CmKA6ZBfqYgZAfouc0YayHlkk01nuNrWF3xMxdRn5ZCVRzyKBhZCtEQZDZD
61577985616724|luucaswyn37p|VZUBKADNI4R6XSOI7PPMRUUIBOAX25AS|xs=18:LWdUOwUno2viZQ:2:1752430784:-1:-1;c_user=61577985616724;presence=C%7B%22t3%22%3A%5B%5D%2C%22utc3%22%3A1753593585845%2C%22v%22%3A1%7D;wd=1056x600;fr=1QE4DKFrV7r1bWEOZ.AWcKwW_xJI4V4d9XlVsaIAgtowNoo8B84ZZxGo6Pm1MIUrV1GUk.Boc_i5..AAA.0.0.Bohbbu.AWfIRikjFQXtsakQ02Fxqbc75sQ;locale=vi_VN;datr=KvhzaDiS72zs8zxjnHsu7EJd;sb=H4OFaChr_bgTbLwa2iwXAxOv;wl_cbv=v2%3Bclient_version%3A2880%3Btimestamp%3A1753580337;pas=61577985616724%3AhrHTqWg6fS;dpr=0.22140221297740936;fbl_st=100623129%3BT%3A29226339;useragent=TW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzExMy4wLjQyMDguODMgU2FmYXJpLzUzNy4zNg%3D%3D|EAAAAUaZA8jlABPOCu2uc2r5gO92BXIF6bJDCuZA7ZBplwteYXjiZBRhlfJcNxhnc1QE9QDDvyHMEnUdofeSQ4PULnMertzFf8Bri1LkjGFo4nzjJpLjAwvhmDrU5ggvmHf8CpxsRTVEZCamrq3ZC4SZCN5srReF3yVWgsRx1eNHYQzHGppgX8mEJQnwzj3Sq8jKKQ6rxAZDZD
61578369357348|lyyoesel53x|K4B2Z3V3ELX55PXEKSRL3X4RHFLMJDKC|c_user=61578369357348;xs=23:fCrQSLj5D6TErQ:2:1752423472:-1:-1;presence=C%7B%22t3%22%3A%5B%5D%2C%22utc3%22%3A1753564662928%2C%22v%22%3A1%7D;wd=1056x596;dpr=0.22140221297740936;fbl_st=100626566%3BT%3A29225825;pas=61578369357348%3AEFBEQO26IB;wl_cbv=v2%3Bclient_version%3A2880%3Btimestamp%3A1753549537;sb=zAqFaIpK6opwxRKH0yaLc3Xc;fr=1p74eZ09GXA4WTK1X.AWccEVXRSBlGmadbmR8n-DO79ULr2CynbGUMag3HrTlAOQBVcpQ.Boc9wn..AAA.0.0.BohUX0.AWfZtw4FSU9su-c9MXlHG0WqE6g;locale=vi_VN;datr=n9tzaI3nMT6kLcnwEQxt9Lh-;useragent=TW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzExNi4wLjM5NzUuMjEgU2FmYXJpLzUzNy4zNg%3D%3D|EAAAAUaZA8jlABPH147ZCG6UP8dl0KFygelTdw1Q2PBe3ZBq503ZCjr39ZA83yJd8FRLgkxJgaOd2To7AqyzZBzi0yh9kIqCNsJhLnLVeb4zxRGj3a0wYars6rhNrb3A98qaotOQH19bLNtI4glE3culrAnzl2ZBZCSPZBvZBZBZAqAOPEx8MUI2kZApSlrPm6DVpHPJNCtVKnQgZDZD
61578198966061|maikarim212k|X74GDN4VV5VHN6GZ2NMRGKRDVAJMTSRF|xs=40:NCcMNMpATGeFZg:2:1752427629:-1:-1;c_user=61578198966061;presence=C%7B%22t3%22%3A%5B%5D%2C%22utc3%22%3A1753588924489%2C%22v%22%3A1%7D;wd=1056x600;fr=113zqbedsJy4sYDZi.AWdK24XGN7FRt9YXEfyBAGbAz1y86wQ5rt7m4GmDvFeBBZ-DU8I.Boc-xk..AAA.0.0.BohaS4.AWePC-MieJq3SxcF5tey1BfTqzI;locale=vi_VN;datr=--tzaCOEvXl70vQ8AnAnr_4p;sb=HnyFaPbe__hNqy50C9cq95x9;wl_cbv=v2%3Bclient_version%3A2880%3Btimestamp%3A1753578540;pas=61578198966061%3AbmY3aMcsIF;dpr=0.22140221297740936;fbl_st=100438314%3BT%3A29226309;useragent=TW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzExNy4wLjc5NTUuODAgU2FmYXJpLzUzNy4zNg%3D%3D|EAAAAUaZA8jlABPIgHh2IbjdIJqeeNYEA3aZCH9BUMwh5lZAkGtjIXHo0FefC8BOIzgsY2MidEAkKdpv53mt8l5aHwBHrq3ehvSFHjUTvQTqfojLHrurTTm40sHqS99H8ZB9bOt4IZAYZBGb7Q7iHjXDKa8V2nfCTHXZCI7hgGLQqbP1VFkxe3m0xAKoprSCdHYcRlJlJBpRGQZDZD`;

const lines = text.trim().split('\n');
const accounts = [];
const thgDir = path.join('d:', 'THG', 'ToolAI', 'thg-lead-gen');

if (!fs.existsSync(path.join(thgDir, 'data'))) {
    fs.mkdirSync(path.join(thgDir, 'data'), { recursive: true });
}

for (let line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    const uid = parts[0];
    const password = parts[1];
    const twofa = parts[2];
    const cookieRaw = parts[3];

    let userAgent = '';
    const uaMatch = cookieRaw.match(/useragent=([^;]+)/);
    if (uaMatch) {
        const b64 = decodeURIComponent(uaMatch[1]);
        userAgent = Buffer.from(b64, 'base64').toString('utf8');
    } else {
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
    }

    const cleanCookie = cookieRaw.replace(/useragent=[^;]+;?/, '');

    accounts.push({
        email: uid, // Login via UID
        password: password,
        proxyUrl: "", // Blank proxy
        "2fa_secret": twofa,
        cookieStr: cleanCookie
    });

    fs.writeFileSync(path.join(thgDir, 'data', `ua_${uid}.txt`), userAgent);
    console.log(`Saved User-Agent for UID ${uid}: ${userAgent}`);
}

const configPath = path.join(thgDir, 'backend', 'config', 'scraper_accounts.json');
fs.writeFileSync(configPath, JSON.stringify(accounts, null, 4));
console.log(`Successfully configured ${accounts.length} scraper accounts in scraper_accounts.json`);
