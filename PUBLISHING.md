# Publishing to npm

## Eenmalige Setup

### 1. Maak een npm account aan (als je er nog geen hebt)
Ga naar https://www.npmjs.com/signup

### 2. Login bij npm

#### Optie A: Met 2FA (Aanbevolen)
```bash
npm login
```
Je krijgt vragen voor:
- Username
- Password
- Email
- One-Time Password (van je authenticator app)

#### Optie B: Met Access Token (Voor CI/CD)
1. Ga naar https://www.npmjs.com/settings/[jouw-username]/tokens
2. Klik "Generate New Token" → "Classic Token"
3. Selecteer "Automation" of "Publish" type
4. Kopieer het token
5. Voeg toe aan je `.npmrc`:
```bash
echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN_HERE" >> ~/.npmrc
```

### 3. Verifieer je bent ingelogd
```bash
npm whoami
```

## Publishing Process

### Stap 1: Build het project
```bash
npm run build
```

### Stap 2: Test de build lokaal
```bash
npm pack --dry-run
```
Dit toont je welke bestanden gepubliceerd zullen worden.

### Stap 3: Controleer de versie
De huidige versie in `package.json` is `1.0.0`.

### Stap 4: Publiceer naar npm
```bash
npm publish
```

### Stap 5: Verifieer de publicatie
```bash
npm view cap-handler-framework
```

## Updates Publiceren

### Voor een bug fix (1.0.0 → 1.0.1)
```bash
npm version patch
npm publish
```

### Voor nieuwe features (1.0.0 → 1.1.0)
```bash
npm version minor
npm publish
```

### Voor breaking changes (1.0.0 → 2.0.0)
```bash
npm version major
npm publish
```

## Belangrijke Checks Voor Publicatie

- ✅ `.npmignore` is correct ingesteld
- ✅ `package.json` heeft correcte informatie
- ✅ `README.md` is up-to-date
- ✅ Build werkt zonder fouten
- ✅ TypeScript definities worden gegenereerd

## Troubleshooting

### "Two-factor authentication... is required to publish packages"
Je hebt 2 opties:

**Optie 1: Gebruik 2FA bij elke publish (VEILIGST)**
1. Zorg dat je een authenticator app hebt (Google Authenticator, Authy, etc.)
2. Ga naar https://www.npmjs.com/settings/[username]/tfa
3. Schakel 2FA in als je dat nog niet hebt gedaan
4. Bij `npm publish` wordt je om een OTP (one-time password) gevraagd
5. Of voer direct uit met OTP:
```bash
npm publish --otp=123456
```

**Optie 2: Gebruik een Access Token**
1. Ga naar https://www.npmjs.com/settings/[username]/tokens
2. Klik "Generate New Token" → "Classic Token"
3. Selecteer "Automation" (dit heeft 2FA bypass)
4. Kopieer het token
5. Gebruik het:
```bash
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN_HERE
npm publish
```

### "Package name is already taken"
De naam is al in gebruik. Je moet een andere naam kiezen in `package.json`.

### "Package already exists"
De naam is al in gebruik. Je moet een andere naam kiezen in `package.json`.

## Nuttige Commands

```bash
# Zie wat er gepubliceerd wordt
npm pack --dry-run

# Test installatie lokaal
npm pack
npm install -g ./cap-handler-framework-1.0.0.tgz

# Unpublish (ALLEEN binnen 72 uur, NIET aangeraden!)
npm unpublish cap-handler-framework@1.0.0

# Deprecate een versie
npm deprecate cap-handler-framework@1.0.0 "Use version 1.0.1 instead"
```

## Post-Publication Checklist

- [ ] Test installatie: `npm install cap-handler-framework`
- [ ] Verifieer op npmjs.com dat de pagina correct wordt weergegeven
- [ ] Tag de release in Git: `git tag v1.0.0 && git push --tags`
- [ ] Maak een GitHub release aan met release notes
