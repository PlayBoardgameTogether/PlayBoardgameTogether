import type { OfficialAiOffer, OfficialAiTokenPricing } from '@boardgame/protocol';

export function tokenSellingRates(pricing: OfficialAiTokenPricing) {
  const format = (points: number) =>
    ((points * (100 + pricing.markupPercent)) / 100).toLocaleString('zh-CN', {
      maximumFractionDigits: 2,
    });
  return `输入 ${format(pricing.inputPointsPerMillion)} / 输出 ${format(pricing.outputPointsPerMillion)} 点 / 百万 token`;
}

export function OfficialAiPrice({ offer }: { offer: OfficialAiOffer }) {
  return offer.tokenPricing ? (
    <>
      <span>{tokenSellingRates(offer.tokenPricing)}</span>
      <br />
      <small>按实际用量合计向上取整；单次最多 {offer.pointsPerAction} 点。</small>
    </>
  ) : (
    <span>{offer.pointsPerAction} 点 / 成功行动（原固定点价）</span>
  );
}
