# 独立维护官方 API 价格

这里是 Tokenews 自己维护的当前 API 参考价。与 `upstream/` 的套餐额度、真实成本和历史证据分开存放；上游同步不会覆盖这个目录。维护价格只改 JSON，不用修改生成脚本或页面。

## 日常维护

1. 在对应厂商的 JSON 文件中添加或修改模型；新增厂商直接新建 `provider-name.json`。所有 JSON 文件会自动加载，没有文件或型号登记列表。
2. 打开官方价格页，核实每种币种、地区、服务档和输入长度的实际价格。填写 `source`、`checkedAt`；不要从缓存折扣比例、渠道售价或相似型号推断价格。
3. 用 `defaultVariant` 明确指定对比页的默认档位。模型页会展示所有已记录档位，不会自动挑最低价。
4. 执行下面的检查，然后构建、测试和提交数据变更。合并本站后走正常部署流程，不需要等待上游发布。

```sh
npm run prices:check                 # 独立校验；只需 Node，无需上游数据或 web 依赖
npm run prices:report                # 按型号查看本站维护 / 仅上游有价 / 缺失，以及不同价格
npm run prices:report -- --json      # 机器可读完整报告，可重定向到文件
npm run build
npm test
npm run check
```

`prices:check` 以及每次网站构建都会检查必填字段、数字、日期、来源链接、重复模型、重复档位、默认档位和输入长度边界。错误会带上文件名和字段位置；负数、未知字段及未来核实日期会阻止构建。

## 文件格式

一个厂商可有多个模型，也可以分成多个文件。跨文件模型 ID 必须唯一。以下是格式示例，型号、来源和价格都须替换为实际核实的内容：

```json
{
  "schemaVersion": 1,
  "provider": "Provider Name",
  "unit": "per_million_tokens",
  "models": [
    {
      "id": "exact-model-id",
      "source": "https://example.com/official/pricing",
      "checkedAt": "2026-10-19",
      "defaultVariant": "standard",
      "variants": [
        {
          "id": "standard",
          "label": { "en": "Standard", "zh": "标准档" },
          "currency": "USD",
          "region": "global",
          "serviceTier": "standard",
          "context": { "min": 0, "max": 200000 },
          "rates": { "input": 1, "cachedInput": null, "cacheWrite": null, "output": 5 }
        }
      ]
    }
  ]
}
```

- `id`：使用本站/上游的**准确模型 ID**，保留版本、速度档等区别。尚未进入上游的 ID 可以先存入，覆盖率报告会列为 `unusedModels`；这不会创建虚构的套餐或渠道。
- `unit`：固定为每 **1,000,000 文本 tokens**，从官方的其他计量单位换算时先核实单位。
- `checkedAt`：实际打开官方来源核实的日期，独立于上游套餐采样日期。
- `source`：主要官方价格页。可选 `additionalSources` 为其他官方文档 URL 的数组，例如缓存计费规则；模型页会一并展示。
- `defaultVariant`：必须指向一个实际存在的档位 ID。改变它会改变对比页采用的参考价。
- `currency`：三位大写币种代码，每个档位可以不同；原币展示，不把其他币种标为美元。标准负载的 USD 参考仅支持已知的 USD、CNY 换算，其他币种保留原价。
- `region`、`serviceTier`：明确写出价格适用范围。`global` 只有确认全球价时才使用；地区可填写 `US`、`CN` 等公开地区代码或供应商的准确区域名称。
- `context.min/max`：**计费使用的输入 token 数的闭区间**，不是模型上下文窗口。`max: null` 表示没有更高的计费档位上界。超过 200,000 的下一档从 `200001` 开始。是否对整次请求涨价请写进 `notes`。
- `rates.input/output`：必须是非负数字。`cachedInput` 必填，未核实用 `null`；`cacheWrite` 可省略或用 `null`。未知项显示 `—`，仅当明确免费时才写 `0`，不自动推算缓存价。
- 模型和每个档位都可以加 `notes: { "en": "...", "zh": "..." }`。补充缓存时长、批处理限制、区域附加费等实际计费条件。

添加长上下文、Batch、Flex、Fast、不同缓存写入时长、忙闲时或区域价格，直接在 `variants` 中增加完整档位。每档显式记录实际价率，避免隐藏倍率和条件；价格核实时检查该模型的全部档位。

## 与上游的关系

- 本站独立核实的记录优先用于**当前 API 参考价**，包括模型页、厂商页、对比页和 explorer 的当前参考区。
- 未独立维护的模型继续显示上游已提供的参考价；未提供的条件和核实日期不猜测。覆盖率报告中的 `upstream-only` 代表这类记录，不代表本站已独立核实。
- 本站默认档位和上游参考价不同会列在 `differences` 中，构建也会提醒核对日期、币种与适用条件。两份数据都保留，不静默改写上游。
- 原始套餐点的 `list_price`、混合价、真实成本、额度和榜单全部保留。更新 API 参考价不会重新解释历史额度样本，也不会把新价格换算成虚构的 API 渠道点。
- `site.json` 的 `generatedAt` 仍是上游采用数据快照日期；`apiPrices.updatedAt` 与每个模型的 `checkedAt` 是独立价格核实日期。涉及这些价格的模型、厂商和对比页面会更新各自的 JSON-LD 和 sitemap 日期。

## 公开下载与生成文件

构建后可访问：

- `/data/api-prices.json`：完整的本站独立价格目录，包括默认档位、全部档位与出处。
- `/data/api-prices/<provider>.json`：对应的原始维护文件。
- `/data/api-price-coverage.json`：当前上游型号的覆盖率、缺口及差异报告。

`web/public/data/` 和 `web/dist/` 都是生成物，**不要手动编辑**。源文件始终是这里的厂商 JSON。删除厂商文件后，下次构建也会移除对应的旧下载文件。
