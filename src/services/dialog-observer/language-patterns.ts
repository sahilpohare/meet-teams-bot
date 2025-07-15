/**
 * Language patterns for modal detection and button text
 */
export class LanguagePatterns {
    static readonly BUTTON_TEXTS = {
        english: [
            'Got it',
            'OK',
            'Dismiss',
            'Close',
            'Continue',
            'Accept',
            'Understood',
            'Cancel',
            'Join',
            'Join now',
            'Decline',
            'Skip',
            'Not now',
            'Later',
            'Maybe later',
            'Leave',
            'Stay',
            'Remain',
            'Exit',
            'Okay',
            'Ok',
            'Alright',
            'Sure',
            'Yes',
            'No',
            'Done',
            'Finish',
            '×',
            '✕',
            'X',
        ],
        french: [
            'Compris',
            'Fermer',
            'Continuer',
            'Accepter',
            "D'accord",
            'Annuler',
            'Participer',
            'Rejoindre',
            'Refuser',
            'Ignorer',
            'Plus tard',
            'Quitter',
            'Partir',
            'Rester',
            'Maintenant',
        ],
        spanish: [
            'Entendido',
            'Vale',
            'De acuerdo',
            'Aceptar',
            'Cerrar',
            'Continuar',
            'Salir',
            'Quedarse',
            'Cancelar',
            'Unirse',
            'Unirse ahora',
            'Rechazar',
            'Omitir',
            'Ahora no',
            'Más tarde',
            'Participar',
            'Entrar',
            'Permitir',
            'Autorizar',
            'Finalizar',
            'Terminar',
        ],
        japanese: [
            'わかりました',
            'OK',
            'オーケー',
            '了解',
            '理解しました',
            '閉じる',
            '続行',
            '受け入れる',
            '同意する',
            'キャンセル',
            '参加',
            '今すぐ参加',
            '辞退',
            'スキップ',
            '後で',
            'もう少し後で',
            '退出',
            '残る',
            '許可',
            '承認',
            '完了',
            '終了',
            'はい',
            'いいえ',
        ],
        chinese_simplified: [
            '明白了',
            '好的',
            'OK',
            '确定',
            '了解',
            '关闭',
            '继续',
            '接受',
            '同意',
            '取消',
            '加入',
            '立即加入',
            '拒绝',
            '跳过',
            '稍后',
            '以后再说',
            '离开',
            '留下',
            '允许',
            '批准',
            '完成',
            '结束',
            '是',
            '否',
        ],
        chinese_traditional: [
            '明白了',
            '好的',
            'OK',
            '確定',
            '了解',
            '關閉',
            '繼續',
            '接受',
            '同意',
            '取消',
            '加入',
            '立即加入',
            '拒絕',
            '跳過',
            '稍後',
            '以後再說',
            '離開',
            '留下',
            '允許',
            '批准',
            '完成',
            '結束',
            '是',
            '否',
        ],
        german: [
            'Verstanden',
            'OK',
            'Schließen',
            'Weiter',
            'Verlassen',
            'Bleiben',
        ],
        portuguese: ['Entendi', 'OK', 'Fechar', 'Continuar', 'Sair', 'Ficar'],
        italian: ['Capito', 'OK', 'Chiudi', 'Continua', 'Esci', 'Rimani'],
        dutch: ['Begrepen', 'OK', 'Sluiten', 'Doorgaan', 'Verlaten', 'Blijven'],
    }

    static getAllButtonTexts(): string[] {
        return Object.values(this.BUTTON_TEXTS).flat()
    }

    static detectLanguage(text: string): string {
        const lowerText = text.toLowerCase()

        for (const [language, patterns] of Object.entries(this.BUTTON_TEXTS)) {
            if (
                patterns.some((pattern) =>
                    lowerText.includes(pattern.toLowerCase()),
                )
            ) {
                return language
            }
        }

        return 'english'
    }

    static containsPatterns(
        text: string,
        patterns: Record<string, string[]>,
    ): boolean {
        const lowerText = text.toLowerCase()
        return Object.values(patterns)
            .flat()
            .some((pattern) => lowerText.includes(pattern.toLowerCase()))
    }
}
