/*
 * i18n data for the Stuart Gardoll customer story (/stories/stuart-gardoll)
 * and its card on the stories index (/stories/). One entry per landing locale;
 * callers fall back to `en` for any locale not present. Regenerate if copy changes.
 */
import en from "./stuart-gardoll-main.html?raw";
import zh from "./stuart-gardoll-main.zh.html?raw";
import zhtw from "./stuart-gardoll-main.zh-tw.html?raw";
import ja from "./stuart-gardoll-main.ja.html?raw";
import ko from "./stuart-gardoll-main.ko.html?raw";
import de from "./stuart-gardoll-main.de.html?raw";
import ru from "./stuart-gardoll-main.ru.html?raw";
import fr from "./stuart-gardoll-main.fr.html?raw";
import es from "./stuart-gardoll-main.es.html?raw";
import ptbr from "./stuart-gardoll-main.pt-br.html?raw";
import it from "./stuart-gardoll-main.it.html?raw";
import vi from "./stuart-gardoll-main.vi.html?raw";
import pl from "./stuart-gardoll-main.pl.html?raw";
import id from "./stuart-gardoll-main.id.html?raw";
import nl from "./stuart-gardoll-main.nl.html?raw";
import ar from "./stuart-gardoll-main.ar.html?raw";
import tr from "./stuart-gardoll-main.tr.html?raw";
import uk from "./stuart-gardoll-main.uk.html?raw";

export const STORY_BODY: Record<string, string> = { en, zh, "zh-tw": zhtw, ja, ko, de, ru, fr, es, "pt-br": ptbr, it, vi, pl, id, nl, ar, tr, uk };

export interface StoryMeta { title: string; description: string }
export const STORY_META: Record<string, StoryMeta> = {
  "en": { title: "“I go to Open Design first” — Stuart Gardoll", description: "Stuart Gardoll — solo AI builder and the Let’s Build YouTuber — ships app UI, motion graphics, and prototypes in Open Design, on whatever model he chooses." },
  "zh": { title: "“我总是先打开 Open Design” — Stuart Gardoll", description: "Stuart Gardoll — 独立 AI 开发者、Let's Build 频道的 YouTube 博主 — 在 Open Design 里交付应用 UI、动态图形和原型,用他自己选的任意模型。" },
  "zh-tw": { title: "“我第一個打開的就是 Open Design” — Stuart Gardoll", description: "Stuart Gardoll — 獨立 AI 開發者、Let's Build YouTuber — 在 Open Design 裡做出 app UI、動態圖像和原型,想用哪個模型就用哪個。" },
  "ja": { title: "“まっ先に開くのは Open Design” — Stuart Gardoll", description: "Stuart Gardoll — ひとりで AI プロダクトを作り、Let's Build を運営する YouTuber — は、アプリ UI、モーショングラフィックス、プロトタイプを、自分が選んだどんなモデルの上でも Open Design で作り上げる。" },
  "ko": { title: "“저는 Open Design을 가장 먼저 엽니다” — Stuart Gardoll", description: "Stuart Gardoll — 1인 AI 빌더이자 Let's Build 유튜버 — 는 앱 UI, 모션 그래픽, 프로토타입을 자신이 고른 어떤 모델로든 Open Design에서 만들어 냅니다." },
  "de": { title: "„Ich gehe zuerst zu Open Design“ — Stuart Gardoll", description: "Stuart Gardoll — Solo-KI-Entwickler und der YouTuber hinter Let's Build — erstellt App-UI, Motion Graphics und Prototypen in Open Design, mit dem Modell seiner Wahl." },
  "ru": { title: "«Первым делом открываю Open Design» — Stuart Gardoll", description: "Stuart Gardoll — независимый разработчик на ИИ и автор YouTube-канала Let's Build — создаёт интерфейсы приложений, моушн-графику и прототипы в Open Design, на любой модели по своему выбору." },
  "fr": { title: "« Open Design, c'est là que je vais en premier » — Stuart Gardoll", description: "Stuart Gardoll — développeur IA solo et YouTubeur de Let's Build — livre UI d'application, motion design et prototypes dans Open Design, sur le modèle de son choix." },
  "es": { title: "“Voy a Open Design primero” — Stuart Gardoll", description: "Stuart Gardoll — creador en solitario con IA y el YouTuber de Let's Build — diseña UI de apps, motion graphics y prototipos en Open Design, con el modelo que elija." },
  "pt-br": { title: "“Eu recorro ao Open Design primeiro” — Stuart Gardoll", description: "Stuart Gardoll — criador solo de IA e o YouTuber do Let's Build — entrega UI de app, motion graphics e protótipos no Open Design, no modelo que ele escolher." },
  "it": { title: "“Vado prima su Open Design” — Stuart Gardoll", description: "Stuart Gardoll — builder AI indipendente e YouTuber di Let's Build — realizza UI di app, motion graphics e prototipi in Open Design, con qualsiasi modello scelga." },
  "vi": { title: "“Tôi tìm đến Open Design đầu tiên” — Stuart Gardoll", description: "Stuart Gardoll — nhà phát triển AI độc lập và YouTuber của kênh Let's Build — làm giao diện ứng dụng, đồ họa chuyển động và prototype trong Open Design, trên bất kỳ mô hình nào anh chọn." },
  "pl": { title: "„Najpierw sięgam po Open Design“ — Stuart Gardoll", description: "Stuart Gardoll — samodzielny twórca AI i youtuber z kanału Let's Build — tworzy interfejsy aplikacji, motion graphics i prototypy w Open Design, na dowolnym modelu, jaki wybierze." },
  "id": { title: "“Open Design yang pertama saya buka” — Stuart Gardoll", description: "Stuart Gardoll — builder AI solo sekaligus YouTuber Let's Build — membuat UI aplikasi, motion graphics, dan prototipe di Open Design, dengan model apa pun yang ia pilih." },
  "nl": { title: "“Ik ga als eerste naar Open Design” — Stuart Gardoll", description: "Stuart Gardoll — solo AI-bouwer en de YouTuber achter Let's Build — maakt app-UI, motion graphics en prototypes in Open Design, op welk model hij ook kiest." },
  "ar": { title: "“أتوجّه إلى Open Design أولًا” — Stuart Gardoll", description: "Stuart Gardoll — مطوّر ذكاء اصطناعي مستقل وصاحب قناة Let's Build على YouTube — يبني واجهات التطبيقات، والرسوم المتحركة، والنماذج الأولية في Open Design، بأي نموذج يختاره." },
  "tr": { title: "“İlk olarak Open Design'a gidiyorum” — Stuart Gardoll", description: "Stuart Gardoll — tek kişilik yapay zekâ geliştiricisi ve Let's Build YouTuber'ı — uygulama arayüzünü, hareketli grafikleri ve prototipleri Open Design'da, hangi modeli seçerse onunla geliştiriyor." },
  "uk": { title: "«Я передусім іду в Open Design» — Stuart Gardoll", description: "Stuart Gardoll — соло-розробник на AI й автор YouTube-каналу Let's Build — створює інтерфейси застосунків, motion-графіку та прототипи в Open Design, на будь-якій моделі, яку обере сам." },
};

export interface StoryCard { title: string; blurb: string }
export const STORY_CARD: Record<string, StoryCard> = {
  "en": { title: "“I go to Open Design first”", blurb: "A solo AI builder and the Let’s Build YouTuber ships apps and motion graphics in Open Design — the creative surface he opens first, on whatever model he chooses." },
  "zh": { title: "“我总是先打开 Open Design”", blurb: "一位独立 AI 开发者、也是 Let's Build 频道的 YouTube 博主,在 Open Design 里做应用和动态图形 — Open Design 是他第一个打开的创作台,用他自己选的任意模型。" },
  "zh-tw": { title: "“我第一個打開的就是 Open Design”", blurb: "一位獨立 AI 開發者、Let's Build YouTuber,在 Open Design 裡做出 app 和動態圖像 — 這是他第一個打開的創作介面,想用哪個模型就用哪個。" },
  "ja": { title: "“まっ先に開くのは Open Design”", blurb: "ひとりで AI プロダクトを作り、Let's Build を運営する YouTuber が、アプリやモーショングラフィックスを Open Design で仕上げる — まっ先に開くクリエイティブな作業場で、自分が選んだどんなモデルの上でも。" },
  "ko": { title: "“저는 Open Design을 가장 먼저 엽니다”", blurb: "1인 AI 빌더이자 Let's Build 유튜버가 앱과 모션 그래픽을 Open Design에서 만들어 냅니다 — 그가 가장 먼저 여는 크리에이티브 서피스로, 자신이 고른 어떤 모델로든." },
  "de": { title: "„Ich gehe zuerst zu Open Design“", blurb: "Ein Solo-KI-Entwickler und der Let's Build-YouTuber erstellt Apps und Motion Graphics in Open Design — die kreative Oberfläche, die er als Erstes öffnet, mit dem Modell seiner Wahl." },
  "ru": { title: "«Первым делом открываю Open Design»", blurb: "Независимый разработчик на ИИ и автор YouTube-канала Let's Build создаёт приложения и моушн-графику в Open Design — творческом пространстве, которое он открывает первым, на любой модели по своему выбору." },
  "fr": { title: "« Open Design, c'est là que je vais en premier »", blurb: "Un développeur IA solo et YouTubeur de Let's Build livre applications et motion design dans Open Design — la surface créative qu'il ouvre en premier, sur le modèle de son choix." },
  "es": { title: "“Voy a Open Design primero”", blurb: "Un creador en solitario con IA y el YouTuber de Let's Build crea apps y motion graphics en Open Design — la superficie creativa que abre primero, con el modelo que elija." },
  "pt-br": { title: "“Eu recorro ao Open Design primeiro”", blurb: "Um criador solo de IA e o YouTuber do Let's Build entrega apps e motion graphics no Open Design — a superfície criativa que ele abre primeiro, no modelo que ele escolher." },
  "it": { title: "“Vado prima su Open Design”", blurb: "Un builder AI indipendente e YouTuber di Let's Build realizza app e motion graphics in Open Design — la prima superficie creativa che apre, con qualsiasi modello scelga." },
  "vi": { title: "“Tôi tìm đến Open Design đầu tiên”", blurb: "Một nhà phát triển AI độc lập kiêm YouTuber của kênh Let's Build làm ứng dụng và đồ họa chuyển động trong Open Design — không gian sáng tạo anh mở đầu tiên, trên bất kỳ mô hình nào anh chọn." },
  "pl": { title: "„Najpierw sięgam po Open Design“", blurb: "Samodzielny twórca AI i youtuber z kanału Let's Build tworzy aplikacje i motion graphics w Open Design — kreatywnej przestrzeni, po którą sięga najpierw, na dowolnym modelu, jaki wybierze." },
  "id": { title: "“Open Design yang pertama saya buka”", blurb: "Seorang builder AI solo sekaligus YouTuber Let's Build membuat aplikasi dan motion graphics di Open Design — ruang kreatif yang pertama ia buka, dengan model apa pun yang ia pilih." },
  "nl": { title: "“Ik ga als eerste naar Open Design”", blurb: "Een solo AI-bouwer en de YouTuber achter Let's Build maakt apps en motion graphics in Open Design — de creatieve werkplek die hij als eerste opent, op welk model hij ook kiest." },
  "ar": { title: "“أتوجّه إلى Open Design أولًا”", blurb: "مطوّر ذكاء اصطناعي مستقل وصاحب قناة Let's Build على YouTube يبني التطبيقات والرسوم المتحركة في Open Design — المساحة الإبداعية التي يفتحها أولًا، بأي نموذج يختاره." },
  "tr": { title: "“İlk olarak Open Design'a gidiyorum”", blurb: "Tek kişilik bir yapay zekâ geliştiricisi ve Let's Build YouTuber'ı, uygulamalarını ve hareketli grafiklerini Open Design'da üretiyor — ilk açtığı yaratıcı zemin, üstelik hangi modeli seçerse onunla." },
  "uk": { title: "«Я передусім іду в Open Design»", blurb: "Соло-розробник на AI й автор YouTube-каналу Let's Build випускає застосунки та motion-графіку в Open Design — креативному полотні, яке він відкриває першим, на будь-якій моделі, яку обере сам." },
};
