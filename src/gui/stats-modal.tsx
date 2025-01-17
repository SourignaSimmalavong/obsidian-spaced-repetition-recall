import { Modal, App, Platform } from "obsidian";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import h from "vhtml";
import {
    Chart,
    BarElement,
    BarController,
    Legend,
    Title,
    Tooltip,
    SubTitle,
    ChartTypeRegistry,
    CategoryScale,
    LinearScale,
    PieController,
    ArcElement,
} from "chart.js";

import type SRPlugin from "src/main";
import { getKeysPreserveType, getTypedObjectEntries } from "src/util/utils";
import { textInterval } from "src/scheduling";
import { t } from "src/lang/helpers";
import { ReviewedCounts } from "src/dataStore/data";
import { State } from "fsrs.js";
import { algorithmNames } from "src/algorithms/algorithms";
import { Stats } from "src/stats";
import { CardListType } from "src/Deck";
import { RPITEMTYPE } from "src/dataStore/repetitionItem";

Chart.register(
    BarElement,
    BarController,
    Legend,
    Title,
    Tooltip,
    SubTitle,
    CategoryScale,
    LinearScale,
    PieController,
    ArcElement,
);

export class StatsModal extends Modal {
    private plugin: SRPlugin;

    constructor(app: App, plugin: SRPlugin) {
        super(app);

        this.plugin = plugin;

        this.titleEl.setText(`${t("STATS_TITLE")} `);
        this.titleEl.addClass("sr-centered");
        this.titleEl.innerHTML += (
            <div>
                <select id="sr-chart-type">
                    <option value={RPITEMTYPE.CARD} selected>
                        {t("FLASHCARDS")}
                    </option>
                    <option value={RPITEMTYPE.NOTE}>{t("NOTES")}</option>
                </select>
                <select id="sr-chart-period">
                    <option value="month" selected>
                        {t("MONTH")}
                    </option>
                    <option value="quarter">{t("QUARTER")}</option>
                    <option value="year">{t("YEAR")}</option>
                    <option value="lifetime">{t("LIFETIME")}</option>
                </select>
            </div>
        );

        this.modalEl.style.height = "100%";
        this.modalEl.style.width = "100%";

        if (Platform.isMobile) {
            this.contentEl.style.display = "block";
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.style.textAlign = "center";

        contentEl.innerHTML += (
            <div>
                <canvas id="todayReviewedChart"></canvas>
                <span id="todayReviewedChartSummary"></span>
                <br />
                <br />
                <canvas id="forecastChart"></canvas>
                <span id="forecastChartSummary"></span>
                <br />
                <br />
                <canvas id="intervalsChart"></canvas>
                <span id="intervalsChartSummary"></span>
                <br />
                <br />
                <canvas id="easesChart"></canvas>
                <span id="easesChartSummary"></span>
                <br />
                <br />
                <canvas id="cardTypesChart"></canvas>
                <br />
                <span id="cardTypesChartSummary"></span>
            </div>
        );

        const chartTypeEl = document.getElementById("sr-chart-type") as HTMLSelectElement;
        chartTypeEl.addEventListener("change", () => {
            const chartType = chartTypeEl.value;
            if (chartType === RPITEMTYPE.NOTE) {
                this.createCharts(
                    this.plugin.store.getReviewedCounts(),
                    this.plugin.noteStats,
                    this.plugin.noteStats.getTotalCount(CardListType.All),
                );
                return;
            } else {
                this.createCharts(
                    this.plugin.store.getReviewedCardCounts(),
                    this.plugin.cardStats,
                    this.plugin.deckTree.getCardCount(CardListType.All, true),
                );
                return;
            }
        });

        this.createCharts(
            this.plugin.store.getReviewedCardCounts(),
            this.plugin.cardStats,
            this.plugin.deckTree.getCardCount(CardListType.All, true),
        );
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }

    private createCharts(rc: ReviewedCounts, cardStats: Stats, totalCardsCount: number) {
        //Add today review data
        // const rc = reviewedCounts;
        const now = window.moment(Date.now());
        const todayDate: string = now.format("YYYY-MM-DD");
        if (!(todayDate in rc)) {
            rc[todayDate] = { due: 0, new: 0 };
        }
        const rdueCnt = rc[todayDate].due,
            rnewCnt = rc[todayDate].new;

        const totalreviewedCount = rdueCnt + rnewCnt;
        createStatsChart(
            "bar",
            "todayReviewedChart",
            t("REVIEWED_TODAY"),
            t("REVIEWED_TODAY_DESC"),
            [`${t("NEW_LEARNED")} - ${rnewCnt}`, `${t("DUE_REVIEWED")} - ${rdueCnt}`],
            [rnewCnt, rdueCnt],
            t("REVIEWED_TODAY_SUMMARY", { totalreviewedCount }),
            t("COUNT"),
            "",
            t("NUMBER_OF_CARDS"),
        );

        // Add forecast
        // const cardStats: Stats = this.plugin.cardStats;
        let maxN: number = cardStats.delayedDays.getMaxValue();
        for (let dueOffset = 0; dueOffset <= maxN; dueOffset++) {
            cardStats.delayedDays.clearCountIfMissing(dueOffset);
        }

        const dueDatesFlashcardsCopy: Record<string, number> = {};
        const todayStr = t("TODAY");
        dueDatesFlashcardsCopy[todayStr] = 0;
        for (const [dueOffset, dueCount] of getTypedObjectEntries(cardStats.delayedDays.dict)) {
            if (dueOffset <= 0) {
                // dueDatesFlashcardsCopy[0] += dueCount;
                dueDatesFlashcardsCopy[todayStr] += dueCount;
            } else {
                // dueDatesFlashcardsCopy[dueOffset] = dueCount;
                const due = now.clone().add(dueOffset, "days");
                const dateStr = due.format("YYYY-MM-DD");
                dueDatesFlashcardsCopy[dateStr] = dueCount;
            }
        }

        const scheduledCount: number = cardStats.youngCount + cardStats.matureCount;
        maxN = Math.max(maxN, 1);

        createStatsChart(
            "bar",
            "forecastChart",
            t("FORECAST"),
            t("FORECAST_DESC"),
            Object.keys(dueDatesFlashcardsCopy),
            Object.values(dueDatesFlashcardsCopy),
            t("REVIEWS_PER_DAY", { avg: (scheduledCount / maxN).toFixed(1) }),
            t("SCHEDULED"),
            t("DATE"),
            t("NUMBER_OF_CARDS"),
        );

        maxN = cardStats.intervals.getMaxValue();
        for (let interval = 0; interval <= maxN; interval++) {
            cardStats.intervals.clearCountIfMissing(interval);
        }

        // Add intervals
        const average_interval: string = textInterval(
                Math.round(
                    (cardStats.intervals.getTotalOfValueMultiplyCount() / scheduledCount) * 10,
                ) / 10 || 0,
                false,
            ),
            longest_interval: string = textInterval(cardStats.intervals.getMaxValue(), false);

        createStatsChart(
            "bar",
            "intervalsChart",
            t("INTERVALS"),
            t("INTERVALS_DESC"),
            Object.keys(cardStats.intervals.dict),
            Object.values(cardStats.intervals.dict),
            t("INTERVALS_SUMMARY", { avg: average_interval, longest: longest_interval }),
            t("COUNT"),
            t("DAYS"),
            t("NUMBER_OF_CARDS"),
        );

        // Add eases
        const eases: number[] = getKeysPreserveType(cardStats.eases.dict);
        for (let ease = Math.min(...eases); ease <= Math.max(...eases); ease++) {
            cardStats.eases.clearCountIfMissing(ease);
        }
        const average_ease: number =
            Math.round(cardStats.eases.getTotalOfValueMultiplyCount() / scheduledCount) || 0;

        const esaeStr: string[] = [];
        getKeysPreserveType(cardStats.eases.dict).forEach((value: number) => {
            if (this.plugin.data.settings.algorithm === algorithmNames.Fsrs) {
                esaeStr.push(`${State[value]} `);
            } else {
                esaeStr.push(`${value} `);
            }
        });

        createStatsChart(
            "bar",
            "easesChart",
            t("EASES"),
            "",
            esaeStr,
            // Object.keys(cardStats.eases),
            Object.values(cardStats.eases.dict),
            t("EASES_SUMMARY", { avgEase: average_ease }),
            t("COUNT"),
            t("EASES"),
            t("NUMBER_OF_CARDS"),
        );

        // Add card types
        // const totalCardsCount: number = this.plugin.deckTree.getCardCount(CardListType.All, true);
        createStatsChart(
            "pie",
            "cardTypesChart",
            t("CARD_TYPES"),
            t("CARD_TYPES_DESC"),
            [
                `${t("CARD_TYPE_NEW")} - ${Math.round(
                    (cardStats.newCount / totalCardsCount) * 100,
                )}%`,
                `${t("CARD_TYPE_YOUNG")} - ${Math.round(
                    (cardStats.youngCount / totalCardsCount) * 100,
                )}%`,
                `${t("CARD_TYPE_MATURE")} - ${Math.round(
                    (cardStats.matureCount / totalCardsCount) * 100,
                )}%`,
            ],
            [cardStats.newCount, cardStats.youngCount, cardStats.matureCount],
            t("CARD_TYPES_SUMMARY", { totalCardsCount }),
        );
    }
}

function createStatsChart(
    type: keyof ChartTypeRegistry,
    canvasId: string,
    title: string,
    subtitle: string,
    labels: string[],
    data: number[],
    summary: string,
    seriesTitle = "",
    xAxisTitle = "",
    yAxisTitle = "",
) {
    const style = getComputedStyle(document.body);
    const textColor = style.getPropertyValue("--text-normal");

    let scales = {},
        backgroundColor = ["#2196f3"];
    if (type !== "pie") {
        scales = {
            x: {
                title: {
                    display: true,
                    text: xAxisTitle,
                    color: textColor,
                },
            },
            y: {
                title: {
                    display: true,
                    text: yAxisTitle,
                    color: textColor,
                },
            },
        };
    } else {
        backgroundColor = ["#2196f3", "#4caf50", "green"];
    }

    const shouldFilter = canvasId === "forecastChart" || canvasId === "intervalsChart";

    const statsE1 = document.getElementById(canvasId) as HTMLCanvasElement;
    const existingChart = Chart.getChart(statsE1);
    if (existingChart) {
        existingChart.unbindEvents();
        existingChart.destroy();
    }

    const statsChart = new Chart(document.getElementById(canvasId) as HTMLCanvasElement, {
        type,
        data: {
            labels: shouldFilter ? labels.slice(0, 31) : labels,
            datasets: [
                {
                    label: seriesTitle,
                    backgroundColor,
                    data: shouldFilter ? data.slice(0, 31) : data,
                },
            ],
        },
        options: {
            scales,
            plugins: {
                title: {
                    display: true,
                    text: title,
                    font: {
                        size: 22,
                    },
                    color: textColor,
                },
                subtitle: {
                    display: true,
                    text: subtitle,
                    font: {
                        size: 16,
                        style: "italic",
                    },
                    color: textColor,
                },
                legend: {
                    display: false,
                },
            },
            aspectRatio: 2,
        },
    });

    if (shouldFilter) {
        const chartPeriodEl = document.getElementById("sr-chart-period") as HTMLSelectElement;
        chartPeriodEl.addEventListener("change", () => {
            if (statsChart.canvas != null) {
                chartPeriodCallBack(chartPeriodEl);
            }
        });
        chartPeriodCallBack(chartPeriodEl);
    }

    document.getElementById(`${canvasId}Summary`).innerText = summary;

    function chartPeriodCallBack(chartPeriodEl: HTMLSelectElement) {
        let filteredLabels, filteredData;
        const chartPeriod = chartPeriodEl.value;
        if (chartPeriod === "month") {
            filteredLabels = labels.slice(0, 31);
            filteredData = data.slice(0, 31);
        } else if (chartPeriod === "quarter") {
            filteredLabels = labels.slice(0, 91);
            filteredData = data.slice(0, 91);
        } else if (chartPeriod === "year") {
            filteredLabels = labels.slice(0, 366);
            filteredData = data.slice(0, 366);
        } else {
            filteredLabels = labels;
            filteredData = data;
        }

        statsChart.data.labels = filteredLabels;
        statsChart.data.datasets[0] = {
            label: seriesTitle,
            backgroundColor,
            data: filteredData,
        };
        statsChart.update();
    }

    document.getElementById(`${canvasId}Summary`).innerText = summary;
}
