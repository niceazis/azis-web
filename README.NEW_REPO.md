# Hermes 새 Repository 자동 설정 가이드

이 문서는 Hermes가 Mac mini에서 `niceazis/luna-template`을 템플릿으로 새 Repository를 생성하고 최초 설정까지 자동 수행하기 위한 실행 지침입니다.

사용자는 Hermes에게 **Repository 이름만** 전달합니다.

예:

```text
hermes-memory-stack 세팅해
```

Hermes는 추가 질문 없이 이 문서를 읽고 아래 절차를 순서대로 수행합니다.

---

## 1. 고정 전제

- GitHub owner: `niceazis`
- 새 Repository는 Hermes가 `niceazis/luna-template`을 템플릿으로 사용해 생성
- Visibility: `Private`
- 기본 branch: `main`
- Mac mini에 `git`, `gh` 설치 완료
- Mac mini의 `gh` 인증 완료

Repository 이름을 `<REPO>`로 표기합니다.

---

## 2. Repository 생성 및 확인

먼저 GitHub 인증을 확인합니다.

```bash
gh auth status
```

대상 Repository가 이미 존재하는지 확인합니다.

```bash
gh repo view niceazis/<REPO> \
  --json nameWithOwner,visibility,defaultBranchRef
```

새 Repository 세팅 요청인데 동일한 이름의 Repository가 이미 존재하면 임의로 덮어쓰거나 삭제하지 말고 사용자에게 보고합니다.

Repository가 없으면 `niceazis/luna-template`을 템플릿으로 사용해 Private Repository를 생성합니다.

```bash
gh repo create niceazis/<REPO> \
  --private \
  --template niceazis/luna-template
```

`--include-all-branches`는 사용하지 않습니다. 따라서 템플릿의 기본 branch만 새 Repository에 생성합니다.

생성 후 확인합니다.

```bash
gh repo view niceazis/<REPO> \
  --json nameWithOwner,visibility,defaultBranchRef
```

확인 기준:

- `nameWithOwner = niceazis/<REPO>`
- `visibility = PRIVATE`
- 기본 branch = `main`

생성에 실패하면 추측해서 진행하지 말고 실제 오류를 보고합니다.

---

## 3. GitHub Repository 설정

Template Repository를 사용해도 Repository Settings 값은 자동 상속되지 않습니다.

다음 설정을 적용합니다.

```bash
gh api \
  --method PATCH \
  repos/niceazis/<REPO> \
  -F allow_squash_merge=true \
  -F delete_branch_on_merge=true

VISIBILITY=$(gh repo view niceazis/<REPO> --json visibility --jq '.visibility')

if [ "$VISIBILITY" = "PUBLIC" ]; then
  gh repo edit niceazis/<REPO> --enable-auto-merge
else
  echo "Private repository: native auto-merge is unavailable on GitHub Free; Luna auto-merge workflow will be used."
fi
```

Actions의 `GITHUB_TOKEN`이 merge 작업을 수행할 수 있도록 기본 workflow 권한을 write로 설정합니다.

```bash
gh api \
  --method PUT \
  repos/niceazis/<REPO>/actions/permissions/workflow \
  -f default_workflow_permissions=write \
  -F can_approve_pull_request_reviews=false
```

설정 확인:

```bash
gh api repos/niceazis/<REPO> \
  --jq '{visibility, default_branch, allow_squash_merge, allow_auto_merge, delete_branch_on_merge}'

gh api repos/niceazis/<REPO>/actions/permissions/workflow
```

확인 기준:

```text
visibility: private
default_branch: main
allow_squash_merge: true
delete_branch_on_merge: true
default_workflow_permissions: write

Public Repository인 경우에만:
allow_auto_merge: true

Private Repository + GitHub Free인 경우:
allow_auto_merge: false
Luna auto merge workflow를 사용
```

---

## 4. Luna / Actions 확인

다음 workflow가 존재하는지 확인합니다.

```bash
gh workflow list -R niceazis/<REPO>
```

확인 대상:

- `Luna test mission`
- `Luna auto merge`

필요하면 workflow를 활성화합니다.

```bash
gh workflow enable luna-test.yml -R niceazis/<REPO>
gh workflow enable luna-auto-merge.yml -R niceazis/<REPO>
```

정상 흐름:

```text
작업 branch
-> Pull Request
-> Luna test mission
-> test 성공
-> Luna auto merge
-> squash merge
-> main
```

---

## 5. Smoke test

로컬 clone 없이 GitHub API로 임시 branch와 파일을 만들어 전체 흐름을 검증합니다.

```bash
SMOKE_BRANCH="chore/luna-smoke-test"

MAIN_SHA=$(gh api repos/niceazis/<REPO>/git/ref/heads/main --jq '.object.sha')

gh api \
  --method POST \
  repos/niceazis/<REPO>/git/refs \
  -f ref="refs/heads/$SMOKE_BRANCH" \
  -f sha="$MAIN_SHA"

SMOKE_CONTENT=$(printf 'Luna smoke test\n' | base64 | tr -d '\n')

gh api \
  --method PUT \
  repos/niceazis/<REPO>/contents/.luna-smoke-test \
  -f message="test: verify Luna auto merge" \
  -f content="$SMOKE_CONTENT" \
  -f branch="$SMOKE_BRANCH"

PR_URL=$(gh pr create \
  -R niceazis/<REPO> \
  --base main \
  --head "$SMOKE_BRANCH" \
  --title "test: verify Luna auto merge" \
  --body "Verify Luna test -> automatic squash merge flow.")

echo "$PR_URL"
```

Checks를 기다립니다.

```bash
gh pr checks "$PR_URL" -R niceazis/<REPO> --watch
```

실제 merge 상태를 확인합니다.

```bash
gh pr view "$PR_URL" -R niceazis/<REPO> \
  --json state,mergedAt,mergeCommit,url
```

자동 머지가 되지 않았다면 바로 수동 merge하지 않습니다.

먼저 workflow 상태와 로그를 확인합니다.

```bash
gh run list -R niceazis/<REPO> --workflow luna-test.yml --limit 5
gh run list -R niceazis/<REPO> --workflow luna-auto-merge.yml --limit 5
```

실패 원인을 수정한 뒤 다시 검증합니다.

---

## 6. Smoke test 파일 삭제

Smoke test PR의 자동 merge가 확인되면 GitHub API로 임시 파일 삭제 branch와 PR을 만듭니다.

```bash
CLEANUP_BRANCH="chore/remove-luna-smoke-test"

MAIN_SHA=$(gh api repos/niceazis/<REPO>/git/ref/heads/main --jq '.object.sha')

gh api \
  --method POST \
  repos/niceazis/<REPO>/git/refs \
  -f ref="refs/heads/$CLEANUP_BRANCH" \
  -f sha="$MAIN_SHA"

SMOKE_SHA=$(gh api \
  "repos/niceazis/<REPO>/contents/.luna-smoke-test?ref=$CLEANUP_BRANCH" \
  --jq '.sha')

gh api \
  --method DELETE \
  repos/niceazis/<REPO>/contents/.luna-smoke-test \
  -f message="chore: remove Luna smoke test" \
  -f sha="$SMOKE_SHA" \
  -f branch="$CLEANUP_BRANCH"

CLEANUP_URL=$(gh pr create \
  -R niceazis/<REPO> \
  --base main \
  --head "$CLEANUP_BRANCH" \
  --title "chore: remove Luna smoke test" \
  --body "Remove temporary Luna smoke-test file.")

gh pr checks "$CLEANUP_URL" -R niceazis/<REPO> --watch

gh pr view "$CLEANUP_URL" -R niceazis/<REPO> \
  --json state,mergedAt,mergeCommit,url
```

Cleanup PR까지 자동 merge되어야 합니다.

---

## 7. 템플릿 README 삭제

Luna smoke test와 cleanup PR이 모두 성공하면 다음 템플릿용 README를 삭제합니다.

```text
README.NEW_REPO.md
README.ko.md
README.md
```

단, 해당 파일 중 하나라도 이미 프로젝트용 내용으로 변경되어 있으면 임의로 삭제하지 말고 보고합니다.

GitHub API로 삭제 branch를 만들고 3개 파일을 삭제합니다.

```bash
README_BRANCH="chore/remove-template-readmes"

MAIN_SHA=$(gh api repos/niceazis/<REPO>/git/ref/heads/main --jq '.object.sha')

gh api \
  --method POST \
  repos/niceazis/<REPO>/git/refs \
  -f ref="refs/heads/$README_BRANCH" \
  -f sha="$MAIN_SHA"

for FILE in README.NEW_REPO.md README.ko.md README.md; do
  FILE_SHA=$(gh api \
    "repos/niceazis/<REPO>/contents/$FILE?ref=$README_BRANCH" \
    --jq '.sha')

  gh api \
    --method DELETE \
    "repos/niceazis/<REPO>/contents/$FILE" \
    -f message="chore: remove template README files" \
    -f sha="$FILE_SHA" \
    -f branch="$README_BRANCH"
done

README_CLEANUP_URL=$(gh pr create \
  -R niceazis/<REPO> \
  --base main \
  --head "$README_BRANCH" \
  --title "chore: remove template README files" \
  --body "Remove README files used only for repository bootstrap.")

gh pr checks "$README_CLEANUP_URL" -R niceazis/<REPO> --watch

gh pr view "$README_CLEANUP_URL" -R niceazis/<REPO> \
  --json state,mergedAt,mergeCommit,url
```

README 삭제 PR까지 자동 merge되어야 최초 세팅 완료입니다.

---

## 8. 최종 검증

```bash
gh repo view niceazis/<REPO> \
  --json nameWithOwner,visibility,defaultBranchRef

gh api repos/niceazis/<REPO> \
  --jq '{allow_squash_merge, allow_auto_merge, delete_branch_on_merge}'

gh run list -R niceazis/<REPO> --limit 10
```

완료 기준:

- Repository가 Private
- 기본 branch가 `main`
- `allow_squash_merge=true`
- `delete_branch_on_merge=true`
- Public Repository면 `allow_auto_merge=true`
- Private Repository + GitHub Free면 `allow_auto_merge=false`여도 정상이며 Luna auto merge workflow를 사용
- Luna test workflow 성공
- Luna auto merge workflow 성공
- Smoke test PR squash merge 완료
- Smoke test 파일 삭제 완료
- README cleanup PR squash merge 완료
- `README.NEW_REPO.md` 삭제
- `README.ko.md` 삭제
- `README.md` 삭제

---

## Hermes에게 보내는 명령

Hermes에게 생성할 Repository 이름만 전달합니다.

```text
<REPO> 세팅해
```

예:

```text
hermes-memory-stack 세팅해
```

Hermes는 이 파일을 읽고 위 절차 전체를 수행합니다.

성공 시:

```text
<REPO> 초기 세팅 완료

- Template Repository로 새 Private Repository 생성 완료
- GitHub 설정 완료
- Repository merge 설정 완료
- Public이면 native auto-merge 확인 / Private이면 Luna auto merge 사용
- Luna/Actions 확인
- Smoke test 성공
- PR 자동 squash merge 성공
- 테스트 파일 정리 완료
- 템플릿 README 정리 완료
```

실패 시 성공한 것처럼 보고하지 말고 실패 단계, 실제 오류, 남은 상태만 정확히 보고합니다.
