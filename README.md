# even-g2-fft

Even G2のマイクで録音し、平均化したFFT振幅スペクトルを表示するアプリの開発プロジェクトです。TypeScriptとEven Hub Web SDKを使用します。

現在は、macOSの内蔵マイクを使い、シミュレーター上で録音の開始・停止、直近5秒の時間波形、録音終了後の平均化FFT表示まで実装・確認しています。G2実機での確認は今後の工程です。

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
4. もう一度シングルタップすると録音区間が閉じ、停止時点の波形に `Calculating...` を重ねて解析します。メッセージは500 msごとに表示／非表示が切り替わり、解析後に全画面FFTへ移ります。計算が速い場合は点滅の切り替わり前に結果が表示されます。
5. 結果画面のシングルタップで新しい録音を開始します。前の録音データはリセットされます。
6. 128 ms未満の録音では短すぎる旨を表示します。シングルタップで録音し直せます。計算中と画面切替中のタップは無視します。

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
- 停止タップで録音区間を即座に閉じ、遅れて届くPCMは記録・解析・波形へ追加しない。
- Web Workerで録音全体のFFTを解析し、計算中は停止時の時間波形に画面中央の `Calculating...` を重ねて点滅。
- 576 × 288 pxのFFT画面を288 × 144 pxの画像4枚で表示。旧画面の送信完了を待ってから画面を再構成し、4枚を直列に転送。
- 結果画面からの再録音と、短すぎる録音や解析エラーからの復帰。

### FFTの解析・表示仕様

| 項目 | 仕様 |
| --- | --- |
| 対象 | 停止タップまでの録音全体 |
| フレーム長 | 2,048サンプル |
| オーバーラップ | 75%（ホップ512サンプル） |
| 窓 | 周期的Hann窓。DC除去なし |
| 周波数分解能 | 7.8125 Hz（16 kHz入力） |
| 正規化・平均 | 窓の振幅利得を補正した片側RMSパワーを、ビンごとに算術平均 |
| dB変換 | `10 log10(meanPower / (2e-5)^2)` |
| 周波数範囲 | 0〜3,000 Hz。500 Hz間隔の目盛りと `Frequency[Hz]` ラベル |
| 縦軸 | `Amplitude` ラベルとdB基準の補助表記。表示範囲内の値でオートスケール |
| 下限処理 | −120 dB以下は−120 dBへ打ち切り、その値を最小・最大値の計算から除外 |
| 上下の余白 | 有効な最大dB値と最小dB値の差の10%ずつ |
| 無音時 | 有効値がなければ−120〜−110 dBで表示 |
| 同一値の場合 | 有効値の差が10⁻⁶ dB以下なら、その中心値の上下5 dBで表示 |
| 不足フレーム | 末尾の不完全なフレームは使用せず、全体が2,048サンプル未満なら再録音を案内 |

フレームごとのパワーは `c × abs(FFT(x × w))^2 / sum(w)^2` とし、係数 `c` は通常ビンで2、DC・ナイキストで1です。dB変換はパワーを平均した後に行います。

dB値は正規化PCMに基準値 `2e-5` を適用した値です。実測音圧への校正係数は含めていません。計算時間を引き延ばすための待機時間は設けていません。

### 確認した結果

以下はシミュレーターでの検証結果です。振幅や更新レートの測定値は、入力音や実行環境によって変わります。

| 確認項目 | 結果 |
| --- | --- |
| 最小表示と入力 | `FFT ready` → シングルタップ → `Tap received` を確認。その後、タップの動作を録音開始・停止へ変更済み |
| 内蔵マイクの受信 | 1件3,200バイト（1,600サンプル）、毎秒約10件を受信 |
| 音への反応 | 声・手拍子で最大振幅が約0.1から0.99997へ上がり、その後低下することを確認 |
| 時間波形 | 発声・無音・再発声で、強い音の区間が右側から左側へ移動することを確認 |
| 更新レート | 通常約5回/秒。波形確認時の計測平均は約4.1回/秒で、一時的な低下あり |
| 停止後の固定 | 解析中も録音区間と背景波形が固定。FFT導入前の波形単体検証では、停止後約28秒間画面が一致 |
| 合成FFT | 1 kHz正弦波のピーク位置を確認。ピーク振幅0.5で約84.95 dB、1で約90.97 dB（RMS基準） |
| FFT画面遷移 | 録音停止→時間波形と点滅表示→全画面FFT→再録音を確認。計算中の追加タップは無視し、短すぎる録音からも復帰 |
| 自動テスト | PCM・波形、独立したDFTとの比較、RMSパワー平均、dBスケール、タイル分割、Worker、点滅、送信完了待ちなど24件が成功 |
| ビルド | FFT Workerを含めて `npm run build` が成功 |

シミュレーター0.9.5での検証では、`audioControl(false)` の戻り値が `false` でもPCM受信は停止しました。戻り値はコンソールログに残します。録音区間は停止タップ時点で閉じ、マイク停止処理とFFT解析を並行して進めます。再録音時は前回の停止要求の完了を待ちます。

点滅の確認では、一時的な検証サーバーでWorker応答を1.8秒遅らせて確認しました。この遅延処理はアプリ本体には含まれていません。

### 今後の工程

- ピークの数値表示とカーソル操作。
- 表示周波数上限の設定と結果画面のメニュー。
- iPhone・G2・R1での表示、入力、マイク受信、転送速度の実機確認。
- `app.json` のアプリ名・パッケージIDなどの調整。

## 主なファイルと確認コマンド

| ファイル | 役割 |
| --- | --- |
| [src/main.ts](src/main.ts) | SDK接続、タップ、音声受信、録音・解析・結果画面の遷移 |
| [src/recording.ts](src/recording.ts) | PCM正規化、録音全体と5秒リングバッファの保持、列ごとの最小・最大値 |
| [src/waveform.ts](src/waveform.ts) | 軸・枠・波形の描画とGray8画像の生成 |
| [src/latest-frame-sender.ts](src/latest-frame-sender.ts) | 転送の直列化、古いフレームの省略、送信完了待ち |
| [src/fft.ts](src/fft.ts) | Hann窓、FFT、RMS基準のパワー平均 |
| [src/fft.worker.ts](src/fft.worker.ts) / [src/fft-client.ts](src/fft-client.ts) | 解析Workerとセッション単位の要求・応答 |
| [src/spectrum.ts](src/spectrum.ts) | dB変換、オートスケール、全画面描画、4タイルへの分割 |
| [src/calculating.ts](src/calculating.ts) | 計算中メッセージの500 ms間隔の点滅 |
| [src/style.css](src/style.css) | WebView側の表示 |
| [tests/recording.test.mjs](tests/recording.test.mjs) | PCMと録音・表示用バッファのテスト |
| [tests/latest-frame-sender.test.mjs](tests/latest-frame-sender.test.mjs) | 転送遅延・失敗・画面切替前の送信完了待ち |
| [tests/fft.test.mjs](tests/fft.test.mjs) / [tests/spectrum.test.mjs](tests/spectrum.test.mjs) | FFTの理論値・DFT比較、dB範囲とタイル分割のテスト |
| [tests/fft-client.test.mjs](tests/fft-client.test.mjs) / [tests/calculating.test.mjs](tests/calculating.test.mjs) | Workerの遅延・失敗・終了と点滅のテスト |

```bash
# 自動テスト
node --experimental-strip-types --test tests/*.test.mjs

# TypeScriptのチェックと本番ビルド
npm run build
```
