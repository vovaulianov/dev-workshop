# Інструкції до проєкту: dev-workshop

Вбудований component explorer для Vite + React. Монтується на `/dev`
у проєкті-споживачі, знаходить файли `*.stories.tsx`, дозволяє
інспектувати елементи, редагувати `style` пропси у джерельному коді й
твікати дизайн-токени — і все це з прямим записом у файли проєкту-
споживача.

## Джерела істини

- **[README.md](README.md)** — публічна інструкція з налаштування й
  використання. Якщо змінюється поведінка — треба синхронно оновити
  README.
- **[package.json](package.json)** — мапа `exports`. Чотири точки
  входу (`.`, `./plugin`, `./ui`, `./context`) є публічним API. Не
  ламай їх без явної потреби.

## Головне правило

**Пакет має лишатися портабельним.** Уся ідея в тому, щоб "вкинути в
будь-який Vite + React проєкт". Усе, що прив'язує його до конкретного
споживача (хардкоднуті шляхи, імпорти з проєкту-споживача, припущення
про назви файлів) — це регресія, навіть якщо воно працює в одному
тестовому проєкті.

## Куди дивитися

| Що ти шукаєш | Де воно |
|---|---|
| Об'єднана точка входу плагіна (`devWorkshop()`) | [`src/plugin/index.ts`](src/plugin/index.ts) |
| Інжектор `data-devsource` атрибутів у JSX | [`src/plugin/jsx-source.ts`](src/plugin/jsx-source.ts) |
| Middleware `/__dev/{read,write,patch-style}` | [`src/plugin/dev-api.ts`](src/plugin/dev-api.ts) |
| Клієнтські fetch-обгортки + утиліти для токенів | [`src/lib/devApi.ts`](src/lib/devApi.ts) |
| Discovery story-файлів (чиста функція над map-ом модулів) | [`src/lib/storyLoader.ts`](src/lib/storyLoader.ts) |
| Резолвер source-локацій (DOM → file:line:col) | [`src/lib/fiberUtils.ts`](src/lib/fiberUtils.ts) |
| Виведення дескрипторів пропсів зі story `args` | [`src/lib/propsInference.ts`](src/lib/propsInference.ts) |
| 3-панельний layout, default export | [`src/ui/DevWorkshopPage.tsx`](src/ui/DevWorkshopPage.tsx) |
| Список компонентів (зліва) | [`src/ui/ComponentSidebar.tsx`](src/ui/ComponentSidebar.tsx) |
| Канвас + ⌘-click select / ⌥-hover distance | [`src/ui/ComponentPreview.tsx`](src/ui/ComponentPreview.tsx) |
| Права панель: Props / Tokens / Code / Element | [`src/ui/StylePanel.tsx`](src/ui/StylePanel.tsx) |
| Редактор `style` пропа вибраного елемента | [`src/ui/ElementInspector.tsx`](src/ui/ElementInspector.tsx) |
| Outline вибраного елемента | [`src/ui/SelectionOverlay.tsx`](src/ui/SelectionOverlay.tsx) |
| Layer відстаней до сусідів | [`src/ui/DistanceLayer.tsx`](src/ui/DistanceLayer.tsx) |
| Інпут із token-autocomplete | [`src/ui/SmartInput.tsx`](src/ui/SmartInput.tsx) |
| Контекст портал-таргету (для ре-роутингу sheet'ів) | [`src/context/PortalTargetContext.tsx`](src/context/PortalTargetContext.tsx) |
| Тип віртуального модуля | [`src/virtual.d.ts`](src/virtual.d.ts) |

## Жорсткі правила

1. **Жодних імпортів із проєкту-споживача.** Увесь код пакета — під
   `src/`. Якщо щось потребує специфічних для проєкту даних (story-
   файли, шлях до CSS), пробрось через опції плагіна, віртуальні
   модулі або React-пропси — ніколи не хардкоди.
2. **Plugin code = Node.js, UI code = browser.** Файли під
   `src/plugin/` можуть використовувати `node:fs`, `node:path`,
   `@babel/parser`. Файли під `src/ui/`, `src/lib/`, `src/context/`
   — ні. У `tsconfig.json` обидва шари, але runtime-кордон реальний.
3. **`apply: "serve"` на кожному плагіні.** Нічого з того, що цей
   пакет додає, не повинно потрапити у production-збірку.
4. **Усі шляхи до файлів проходять через `inRoot()`** у `dev-api.ts`.
   Ніколи не приймай шлях від клієнта без перевірки, що він лишається
   всередині кореня проєкту.
5. **Story сумісні з CSF v3.** Файл `*.stories.tsx` із
   `export default { title, component }` + named story exports має
   працювати без адаптера. Не вигадуй кастомний формат.
6. **`virtual:dev-workshop/stories` — єдиний спосіб, у який сторінка
   отримує stories.** Прямий `import.meta.glob` десь усередині пакета
   обходить glob, який налаштовує споживач, і ламає портабельність.
7. **Атрибут `data-devsource` виживає JSX-трансформ.** Плагін має
   стояти з `enforce: "pre"`, щоб атрибут уже був на місці до того,
   як `@vitejs/plugin-react` перепише дерево.
8. **Виділення елемента стабільне крізь HMR.** `DevWorkshopPage`
   ре-резолвить `selectedEl.element` через селектор по
   `data-devsource`, коли DOM змінюється — збережи цю поведінку.
9. **CSS-правила тільки на `.dw-*` класах, ніколи на голих тегах.**
   Усі компоненти користувача рендеряться як descendants
   `[data-dev-workshop]` (всередині канвасу). Тому правило типу
   `[data-dev-workshop] button { ... }` чи `[data-dev-workshop] * { ... }`
   протече в його кнопки/елементи й зламає верстку. Кожен `.dw-*`
   клас сам скидає те, що йому треба (`appearance`, `border`, `cursor`,
   `font-family`).

## Додавання фічі

Decision tree:

- **Нова вкладка у правій панелі** (наприклад "A11y", "Network")? →
  додай у `StylePanel.tsx`. Кожна вкладка — це самостійна секція;
  скопіюй патерн існуючих.
- **Нова взаємодія на рівні елемента** (наприклад "show grid")? →
  новий overlay-компонент під `src/ui/`, монтований із
  `ComponentPreview.tsx`. Не накопичуй ще більше стану в самому
  Preview.
- **Нова файлова операція** (наприклад rename, search)? → endpoint
  у `src/plugin/dev-api.ts` + відповідна клієнтська обгортка у
  `src/lib/devApi.ts`. Завжди валідуй шлях через `inRoot()`.
- **Нова метадата для story** (наприклад parameters, decorators)? →
  розширюй `buildComponentEntries()` у `src/lib/storyLoader.ts`.
  Тримай це чистою функцією — простіше тестувати, нема coupling-у з
  Vite.

Коли робиш новий публічний surface:

- Додай у `package.json` як до `exports`, так і до `files`.
- Оновлюй README й цю таблицю "Куди дивитися" у тій самій зміні.

## Те, що схоже на конфіг, але не воно

- Парсер `:root { ... }` блоку у вкладці Tokens вважає, що блок один
  і він на верхньому рівні. Вкладені або scope-овані токени він не
  бачить. Якщо це треба — змінюй парсер свідомо, не "розширюй мовчки".
- `patchStyle()` у `dev-api.ts` пише лише літеральні ключі/значення в
  JSX `style={{ ... }}`. Spread-и й обчислені вирази зберігаються, але
  не редагуються. Не намагайся "виправити" це без реального плану.

## Нагадування про стек

- **Vite 5+** для plugin API (`resolveId`/`load`/`transform` і
  middleware через `configureServer`). Не використовуй API, що з'явилися
  лише у Vite 6, поки не піднято peer-діапазон.
- **React 19** у dev (пакет користується патернами на
  `useCallback`/`useEffect`); декларований peer — `>=18`, тобто
  споживачі на 18 теж мають працювати.
- **Стилі чрому — лише inline + власний `<style>` блок із
  `.dw-*` класами** (див. `STYLES` константу у `DevWorkshopPage.tsx`).
  Жодного Tailwind. Будь-яке нове правило має або жити inline у місці
  використання, або у тому ж блоці, заскоупленому через `[data-dev-workshop]`.
  **Жодних правил на голих тегах** (`button`, `input`, `*`, etc.) —
  вони протекли б у компоненти користувача, які рендеряться у канвасі
  як descendants `[data-dev-workshop]`. Кожен `.dw-*` клас має сам
  скидати `appearance`, `border`, `cursor`, `font-family` тощо.
- **`@babel/parser` + `@babel/types`** — це runtime-залежності
  плагіна (Node.js сторона). Тримай їх у `dependencies`, а не у
  `devDependencies`.
- **Без build-step.** Споживачі імпортують `.tsx` source напряму;
  їхній bundler робить решту. Не додавай build pipeline, поки не
  буде свідомого рішення публікувати у npm із компільованим виходом.

## Як перевіряти зміни

Коли змінюєш код пакета:

- `npm run typecheck` — тайп-чекає і браузерну, і плагінну сторону.
- Для runtime: `npm install /abs/шлях/до/цього` у тестовому
  Vite + React + Tailwind проєкті, підключи `devWorkshop()` і
  роут `/dev`, напиши `*.stories.tsx`, відкрий `/dev`. Пройдися по
  потоках Props / Tokens / Code / Element.
- Touch-тести:
  - Sidebar показує твій компонент → preview рендериться → ⌘+click
    селектить → права панель перемикається на вкладку "Element".
  - Зміна значення `style` → файл на диску патчиться.
  - Вкладка Tokens → змінюй `--color-*` → блок `:root` у CSS-файлі
    оновлюється.

## Що поза скоупом

- CLI (`npx dev-workshop init`). Налаштування — це два рядки
  конфігу; CLI було б більше коду на підтримку, ніж економії.
- Бандл story-файлів поза проєктом-споживачем (наприклад, із source
  іншого пакета). Поки що — single-project.
- Production-mode component browsing. Увесь пакет навмисне dev-only;
  модель безпеки виходить із того, що локальна машина — довірена.
