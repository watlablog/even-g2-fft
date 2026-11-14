# even-g2-fft

Even G2のマイクで録音し、平均化したFFT振幅スペクトルを表示するアプリの開発プロジェクトです。TypeScriptとEven Hub Web SDKを使用します。

現在は、macOSの内蔵マイクを使い、シミュレーター上で録音の開始・停止と直近5秒の時間波形表示まで実装・確認しています。FFT解析とG2実機での確認は今後の工程です。

## 検証環境と依存パッケージ

2026年11月14日時点の検証に使用したバージョンです。OSとCPUは動作確認時の参考情報として記載しています。

| 項目 | 確認結果 |
| --- | --- |
| macOS | 14.5（23F79） |
| CPUアーキテクチャ | arm64（Apple Silicon） |
| Node.js | v24.3.0 |
| npm | 11.4.2 |
| Vite | 8.3.8 |
| TypeScript | 7.0.2 |
| `@evenrealities/even_hub_sdk` | 0.0.16 |
| `@evenrealities/evenhub-cli` | 0.2.0 |
| `@evenrealities/evenhub-simulator` | 0.9.5 |

導入済みのバージョンは `npm ls --depth=0` で確認できます。`package-lock.json` を保持しています。

## macOSでの環境構築

macOSでのセットアップ手順と、プロジェクトの初期構築時に実施した内容をまとめています。

コマンド内の `/path/to/even-g2-fft` は、手元の作業フォルダのパスに置き換えてください。

### 1. リポジトリのクローン

空の作業フォルダへ移動し、そのフォルダをリポジトリのルートとしてクローンします。

```bash
cd /path/to/even-g2-fft
git clone https://github.com/watlablog/even-g2-fft.git .
```

### 2. 既存環境の確認

```bash
sw_vers
uname -m
command -v node
node -v
npm -v
```

Node.jsとnpmが導入済みの場合は、バージョンを確認して使用します。未導入の場合は、先にNode.jsとnpmを導入してください。

### 3. ViteのTypeScript雛形の配置

最初に、作業場所がリポジトリのルートであることを確認します。

```bash
git status --short
git rev-parse --show-toplevel
```

初期構築では、`create-vite` 9.3.4の `vanilla-ts` テンプレートで雛形を生成し、一時ディレクトリを経由してリポジトリのルートへ配置しました。クローン後は配置済みのソースを使用します。既存ファイルのあるフォルダに雛形を配置する場合は、一時ディレクトリで生成して必要なファイルを移し、既存ファイルを保持します。

リポジトリのルートで依存パッケージを導入し、ビルドします。

```bash
npm install
npm run build
```

ビルドが成功すると `dist/` が生成されます。`node_modules/` と `dist/` は `.gitignore` の除外対象です。

### 4. SDK・CLI・シミュレーターの導入

初期構築では、以下のコマンドで3パッケージを導入して起動を確認し、`app.json` を生成しました。クローン後の依存パッケージは、前節の `npm install` で導入されます。

```bash
npm install @evenrealities/even_hub_sdk
npm install -D @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
npm ls --depth=0
npx evenhub --version
npx evenhub-simulator --help
npx evenhub init
npm run build
```

3パッケージの導入、CLIのバージョン表示、シミュレーターのヘルプ表示、ビルドの成功を確認しました。導入時のnpm監査では脆弱性0件でした。

`app.json` は `npx evenhub init` で新規生成しました。現在の名前は `G2 Demo`、パッケージIDは `com.example.g2demo` で、生成時の初期値を保持しています。

シミュレーターの実行リンクが見つからない場合は、次のコマンドで再作成できます。

```bash
npm rebuild @evenrealities/evenhub-simulator
```

### 5. 内蔵マイクの確認

```bash
npx evenhub-simulator --help
npx evenhub-simulator --list-audio-input-devices
```

一覧から使用する内蔵マイクのデバイスIDを確認します。以下は指定例です。表示名やデバイスIDは、実行環境の一覧に合わせて読み替えてください。

| 項目 | 例 |
| --- | --- |
| デバイス名 | 内蔵マイク（表示名は環境により異なります） |
| デバイスID | `coreaudio:BuiltInMicrophoneDevice` |

開発サーバーを使用する場合は、`npm run dev` が表示するURL（例：`http://localhost:5173/`）をシミュレーターに渡し、`--aid` で使用するマイクを指定します。

## シミュレーターの起動と手動テスト

ビルド済みの画面を使う場合は、ターミナルを2つ開きます。

### ターミナル1：ビルドとプレビューサーバー

```bash
cd /path/to/even-g2-fft
npm run build
npm run preview -- --port 4173 --strictPort
```

サーバーを起動したままにします。`--strictPort` を指定しているため、4173番ポートが使用中の場合は既存のサーバーを終了してから再実行してください。

### ターミナル2：内蔵マイクを指定して起動

以下は、内蔵マイクのデバイスIDが `coreaudio:BuiltInMicrophoneDevice` の場合のコマンド例です。

```bash
cd /path/to/even-g2-fft
npx evenhub-simulator http://localhost:4173/ --aid "coreaudio:BuiltInMicrophoneDevice"
```

`--aid` の値は `--list-audio-input-devices` の結果に合わせて指定してください。macOSのマイク許可が表示された場合は「許可」を選択します。

### 操作

1. 初期画面に `FFT ready` と `Tap to record` が表示されます。
2. シミュレーターの `Click`（シングルタップ）操作で録音を開始します。
3. 選択したマイクに向かって「話す → 数秒黙る → また話す」と操作し、音の強い区間が右端から左へ移動することを確認します。
4. もう一度シングルタップすると録音区間が閉じ、停止時点の波形で固定されます。マイクの停止確認後に `Stopped` と表示されます。
5. 次のシングルタップで新しい録音を開始します。前の録音データはリセットされます。

録音データはメモリ内に保持します。音声ファイルへの保存は実装していません。

コードを変更した場合は、再度 `npm run build` を実行し、シミュレーターを終了して起動し直してください。プレビューサーバーはビルド済みの `dist/` を配信します。

### 開発サーバーを使う場合

```bash
# ターミナル1
npm run dev
```

```bash
# ターミナル2（Viteが表示した実際のURLを指定）
npx evenhub-simulator http://localhost:5173/ --aid "coreaudio:BuiltInMicrophoneDevice"
```

開発中の自動リロードで初期ページの作成が重複し、`Failed to create startup page: 1` になることがあります。その場合はシミュレーターを終了して起動し直します。手動テストには上記のプレビューサーバーを使用できます。

## 現在の開発状況

### 実装済み

- `waitForEvenAppBridge()` で接続し、入力を受け付けるテキストコンテナと波形用の画像コンテナを作成。
- `onEvenHubEvent()` でシングルタップを受信し、`audioControl(true)` / `audioControl(false)` でマイクを操作。
- `event.audioEvent.audioPcm` の16 kHz・モノラル・符号付き16-bitリトルエンディアンPCMを、32768で割って正規化。
- 録音区間全体のPCM配列と、表示用の直近5秒（80,000サンプル）のリングバッファを個別に保持。
- 288 × 144 pxの画像コンテナ1枚に、各ピクセル列の最小値・最大値を縦線で描画。
- 横軸は左0、右5で固定し、その下の中央に `Time[s]` を表示。0〜5は表示窓内の位置を表し、右端の5が最新サンプルに対応。
- 縦軸は−1〜+1で固定し、プロットの枠を全周に描画。録音開始から5秒未満の未収録部分には波形を描画しない。
- 200 ms間隔（毎秒5回が目安）で画像を更新。同時に送る画像は1件とし、転送中の更新要求はまとめて、次に送れる時点の最新波形を描画。
- 停止タップで録音区間を即座に閉じ、遅れて届くPCMは記録・波形へ追加しない。転送中の画像があれば、その後に停止時点の最終波形を送信。

### 確認した結果

以下はシミュレーターでの検証結果です。振幅や更新レートの測定値は、入力音や実行環境によって変わります。

| 確認項目 | 結果 |
| --- | --- |
| 最小表示と入力 | `FFT ready` → シングルタップ → `Tap received` を確認。その後、タップの動作を録音開始・停止へ変更済み |
| 内蔵マイクの受信 | 1件3,200バイト（1,600サンプル）、毎秒約10件を受信 |
| 音への反応 | 声・手拍子で最大振幅が約0.1から0.99997へ上がり、その後低下することを確認 |
| 時間波形 | 発声・無音・再発声で、強い音の区間が右側から左側へ移動することを確認 |
| 更新レート | 通常約5回/秒。波形確認時の計測平均は約4.1回/秒で、一時的な低下あり |
| 停止後の固定 | 波形確認時、録音全体651,200サンプル（40.7秒）と表示用80,000サンプルが固定。停止後約28秒間、画面が一致 |
| 自動テスト | PCM変換・空欄・スクロール・全録音保持・停止時固定・画像転送の直列化など7件が成功 |
| ビルド | 時間軸ラベルの最終修正後も `npm run build` が成功 |

シミュレーター0.9.5での検証では、`audioControl(false)` の戻り値が `false` でもPCM受信は停止しました。現在は戻り値を画面に残し、停止要求後に2秒以上PCMが届かないことを別に確認して `Stopped` に移行します。録音区間と波形は、この確認待ちの間も停止タップ時点で固定しています。

### 今後の工程

- 合成PCM（1 kHz・振幅0.5）によるFFTのピークと振幅の検証。
- 録音区間全体のFFTと線形振幅の平均化。
- `Calculating...`、スペクトル画像、ピーク表示、カーソル操作。
- 表示周波数上限の設定と結果画面のメニュー。
- iPhone・G2・R1での表示、入力、マイク受信、転送速度の実機確認。
- `app.json` のアプリ名・パッケージIDなどの調整。

## 主なファイルと確認コマンド

| ファイル | 役割 |
| --- | --- |
| [src/main.ts](src/main.ts) | SDK接続、コンテナ作成、タップ、音声受信、開始・停止、更新処理 |
| [src/recording.ts](src/recording.ts) | PCM正規化、録音全体と5秒リングバッファの保持、列ごとの最小・最大値 |
| [src/waveform.ts](src/waveform.ts) | 軸・枠・波形の描画とGray8画像の生成 |
| [src/latest-frame-sender.ts](src/latest-frame-sender.ts) | 転送の直列化と古いフレームの省略 |
| [src/style.css](src/style.css) | WebView側の表示 |
| [tests/recording.test.mjs](tests/recording.test.mjs) | PCMと録音・表示用バッファのテスト |
| [tests/latest-frame-sender.test.mjs](tests/latest-frame-sender.test.mjs) | 転送遅延・失敗・終了時のテスト |

```bash
# 自動テスト
node --experimental-strip-types --test tests/*.test.mjs

# TypeScriptのチェックと本番ビルド
npm run build
```
