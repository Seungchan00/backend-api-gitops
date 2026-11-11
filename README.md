
# backend-api-gitops

Kind 로컬 멀티노드 클러스터 위에서 동작하는 GitOps 배포 저장소입니다.
ArgoCD가 레포를 감시하고, Helm 차트를 렌더링해서 클러스터 상태와 일치시킵니다.


## 아키텍처 흐름
App 레포 PR merge -> CI(빌드, Trivy, GHCR 푸시) -> 이 레포의 values-dev.yaml의 image.tag 갱신
-> ArgoCD가 감지 -> Helm 렌더링 -> 클러스터 적용

## 디렉토리 구조
- cluster/kind-config.yaml : kind 클러스터 정의
- bootstrap/root-app.yaml: App-of-Apps 진입점
- apps/ : dev-app.yaml, prod-app.yaml
- helm-charts/my-app/values/values-dev.yaml,values-prod.yaml
- monitoring/ : kube-prometheus-stack values, Grafana 대시보드 Json
- loadtest/ : k6 스크립트 

## 재현 절차

### 0. 사전준비 (macOS, zsh 기준)

```
brew install --cask docker

brew install kubectl kind helm
```

이 README는 `kubectl` 을  `k` 로 줄여서 사용합니다. 아래 설정으로 alias를 설정하세요.

```
echo 'alias k=kubectl' >> ~/.zshrc
echo 'autoload -Uz compinit && compinit' >> ~/.zshrc 
echo 'source <(kubectl completion zsh)' >> ~/.zshrc
echo 'compdef k=kubectl' >> ~/.zshrc
source ~/.zshrc
k version --client 
```

- bash를 쓴다면 `compdef k=kubectl` 대신 `complete -F __start_kubectl k` 사용
`~/.bashrc`에 추가합니다. zsh에서 `complete`는  command not found 발생

- 이 명령어들을 '.sh' 스크립트로 묶어서 실행하면 'k'가 적용 되지 않습니다. 스크립트에서는 'kubectl' 을 사용하세요.

### 1. 클러스터 생성
```
kind create cluster --config cluster/kind-config.yaml --name devops-portfolio

k get nodes
```

### 2.ingress-Nginx 설치 및 노드 고정
```
k apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

k patch deployment ingress-nginx-controller -n ingress-nginx --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/nodeSelector/ingress-ready","value":"true"}]'
k get pods -n ingress-nginx -o wide
```
Node는 control-plane 이어야 합니다. hostPort 80/443 매핑이 해당 노드에만 있습니다.

### 3. Metrics-Server 설치
```
k apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

k patch deployment metrics-server -n kube-system --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

k top nodes 
```
### 4. ArgoCD 설치
```
k create namespace argocd

k apply -n argocd --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

k get pods -n argocd
```
### 5. 모니터링 스택
```
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace -f monitoring/kube-prometheus-stack-values.yaml

k get pods -n monitoring
```
### 6. App-of-Apps 부트스트랩
```
k apply -f bootstrap/root-app.yaml

k get applications -n argocd
```

## 환경 분리 dev/prod

dev 에서는 빠른 검증을 위해 자동배포, 최소 자원으로만 검증가능하게 replica: 1 설정 requests 50m/64Mi limits 200m/128Mi 설정

prod 에서는 노드 하나가 죽어도 서비스가 유지되는 가용성 유지. requests 100m/128Mi , limits 500m/256Mi 설정, 검증된 태그로 사람이 배포하게 설정.  HPA min: 3 max: 10 CPU: 50% Memory: 70%로 설정

## 부하 테스트 
`loadtest/load-test.js`로 prod에 k6 부하 줍니다.

```
k6 run loadtest/load-test.js
```
단일 IP에서 쓰면 Ingress의 IP당 rate limit에 막혀 대부분 503이 나기 때문에 스케일아웃을 보려면 prod `limit-rps` GIT으로 임시 상향하고, 필요하면 HPA CPU 임계치도 낮춘 뒤 실험하면 됩니다. 테스트가 끝나면 되돌립니다.
## 알려진 제약
- 단일 Kind 클러스터에서 네임스페이스로 환경 분리 (실무는 클러스터 분리)
- Ingress 컨트롤러는 Kind의 hostPort 매핑 때문에 control-plane 고정 필수
- 부하 테스트에서는 단일 IP 한계로 prod rate limit과 HPA 임계치를 일시 조정했고 이후 원복
- Trivy는 amd64 이미지만 스캔


