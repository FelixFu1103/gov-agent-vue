export const chunkRetrievalCases = [
  { id: 'chunk-01', question: '职工医保参保登记要交哪些材料？', expectedIntent: 'medical_employee_enrollment', expectedDocument: '09-medical-enrollment.md', expectedSectionType: 'materials' },
  { id: 'chunk-02', question: '异地就医备案有哪些人员类别和证明？', expectedIntent: 'cross_region_medical_filing', expectedDocument: '10-cross-region-medical.md', expectedSectionType: 'materials' },
  { id: 'chunk-03', question: '零星报销一般几个工作日，收费吗？', expectedIntent: 'medical_expense_reimbursement', expectedDocument: '11-medical-reimbursement.md', expectedSectionType: 'deadline_fee' },
  { id: 'chunk-04', question: '居民医保参保从哪里申请？', expectedIntent: 'medical_resident_enrollment', expectedDocument: '31-resident-medical-enrollment.md', expectedSectionType: 'channels' },
  { id: 'chunk-05', question: '生育医疗费报销需要哪些票据和病历？', expectedIntent: 'maternity_medical_payment', expectedDocument: '32-maternity-medical-expense.md', expectedSectionType: 'materials' },
  { id: 'chunk-06', question: '家庭共济账户余额可以给家人支付什么？', expectedIntent: 'medical_family_mutual_aid', expectedDocument: '33-family-mutual-aid.md', expectedSectionType: 'benefits' },
  { id: 'chunk-07', question: '新公司医保开户需要提交什么材料？', expectedIntent: 'medical_unit_enrollment', expectedDocument: '34-unit-enrollment.md', expectedSectionType: 'materials' },
  { id: 'chunk-08', question: '参保姓名和身份证信息变更要什么材料？', expectedIntent: 'medical_insured_info_change', expectedDocument: '35-insured-info-change.md', expectedSectionType: 'materials' },
  { id: 'chunk-09', question: '单位申报医保缴费基数多久办好？', expectedIntent: 'medical_contribution_base_declaration', expectedDocument: '36-contribution-base-declaration.md', expectedSectionType: 'deadline_fee' },
  { id: 'chunk-10', question: '在哪里查询医保参保状态和缴费记录？', expectedIntent: 'medical_insurance_info_query', expectedDocument: '37-insurance-info-query.md', expectedSectionType: 'channels' },
  { id: 'chunk-11', question: '医保个人账户余额什么情况允许取出？', expectedIntent: 'medical_personal_account_withdrawal', expectedDocument: '38-personal-account-withdrawal.md', expectedSectionType: 'eligibility' },
  { id: 'chunk-12', question: '医保关系转移接续总共需要多长时间？', expectedIntent: 'medical_insurance_transfer', expectedDocument: '39-insurance-transfer.md', expectedSectionType: 'deadline_fee' },
  { id: 'chunk-13', question: '申请门诊慢特病认定要带哪些检查资料？', expectedIntent: 'outpatient_chronic_special_disease', expectedDocument: '40-outpatient-chronic-special.md', expectedSectionType: 'materials' },
  { id: 'chunk-14', question: '双通道药品待遇认定需要什么申请表？', expectedIntent: 'dual_channel_drug_qualification', expectedDocument: '41-dual-channel-drug.md', expectedSectionType: 'materials' },
  { id: 'chunk-15', question: '申请生育津贴多久办结，收不收费？', expectedIntent: 'maternity_allowance_payment', expectedDocument: '42-maternity-allowance.md', expectedSectionType: 'deadline_fee' }
]
